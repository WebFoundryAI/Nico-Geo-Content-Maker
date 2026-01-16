/**
 * GitHub REST API Client
 *
 * Minimal GitHub API client for write-back operations.
 * Uses fetch for all HTTP requests - no external dependencies.
 *
 * SECURITY REQUIREMENTS:
 * - Token must be passed at runtime, never hardcoded
 * - Repository must be explicitly specified
 * - All operations require authentication
 * - Fails loudly on permission errors
 *
 * SUPPORTED OPERATIONS:
 * - Get file contents (for SHA retrieval)
 * - Create or update files
 * - Create commits via the Contents API
 */

/**
 * GitHub API base URL.
 */
const GITHUB_API_BASE = 'https://api.github.com';

/**
 * User agent for API requests.
 */
const USER_AGENT = 'NicoGeoBot/1.0 (GitHub Write-Back)';

/**
 * Target repository configuration.
 */
export interface TargetRepo {
  owner: string;
  repo: string;
  branch: string;
}

/**
 * GitHub client configuration.
 */
export interface GitHubClientConfig {
  token: string;
  target: TargetRepo;
}

/**
 * File content response from GitHub API.
 */
export interface GitHubFileContent {
  name: string;
  path: string;
  sha: string;
  size: number;
  content: string; // Base64 encoded
  encoding: 'base64';
  type: 'file';
}

/**
 * Commit result from file creation/update.
 */
export interface CommitResult {
  sha: string;
  path: string;
  message: string;
  url: string;
}

/**
 * Error thrown when GitHub API returns an error.
 */
export class GitHubAPIError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly response?: unknown
  ) {
    super(message);
    this.name = 'GitHubAPIError';
  }
}

/**
 * Validates that required configuration is present.
 */
function validateConfig(config: GitHubClientConfig): void {
  if (!config.token) {
    throw new GitHubAPIError('GitHub token is required for write-back operations', 401);
  }
  if (!config.target.owner) {
    throw new GitHubAPIError('Target repository owner is required', 400);
  }
  if (!config.target.repo) {
    throw new GitHubAPIError('Target repository name is required', 400);
  }
  if (!config.target.branch) {
    throw new GitHubAPIError('Target branch is required', 400);
  }
}

/**
 * Creates standard headers for GitHub API requests.
 */
function createHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': USER_AGENT,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/**
 * Makes a GitHub API request and handles errors.
 */
async function apiRequest<T>(
  method: string,
  url: string,
  token: string,
  body?: unknown
): Promise<T> {
  const options: RequestInit = {
    method,
    headers: createHeaders(token),
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    let errorBody: unknown;
    try {
      errorBody = await response.json();
    } catch {
      errorBody = await response.text();
    }

    // Provide specific error messages for common cases
    if (response.status === 401) {
      throw new GitHubAPIError(
        'GitHub authentication failed. Check that the token is valid and has required permissions.',
        401,
        errorBody
      );
    }
    if (response.status === 403) {
      throw new GitHubAPIError(
        'GitHub permission denied. Token may lack write access to the repository.',
        403,
        errorBody
      );
    }
    if (response.status === 404) {
      throw new GitHubAPIError(
        'GitHub resource not found. Check repository name, owner, and branch.',
        404,
        errorBody
      );
    }
    if (response.status === 422) {
      throw new GitHubAPIError(
        'GitHub rejected the request. The file may already exist or the SHA may be incorrect.',
        422,
        errorBody
      );
    }

    throw new GitHubAPIError(
      `GitHub API error: ${response.status} ${response.statusText}`,
      response.status,
      errorBody
    );
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}

/**
 * Gets the contents of a file from GitHub.
 * Returns null if the file does not exist.
 */
export async function getFileContents(
  config: GitHubClientConfig,
  path: string
): Promise<GitHubFileContent | null> {
  validateConfig(config);

  const url = `${GITHUB_API_BASE}/repos/${config.target.owner}/${config.target.repo}/contents/${path}?ref=${config.target.branch}`;

  try {
    const response = await apiRequest<GitHubFileContent>('GET', url, config.token);
    return response;
  } catch (err) {
    if (err instanceof GitHubAPIError && err.status === 404) {
      return null; // File doesn't exist
    }
    throw err;
  }
}

/**
 * Decodes base64 content from GitHub API response.
 */
export function decodeContent(content: string): string {
  // GitHub returns base64 with newlines, need to remove them
  const cleaned = content.replace(/\n/g, '');
  // Use atob for browser/worker environments, Buffer for Node
  if (typeof atob === 'function') {
    return atob(cleaned);
  }
  return Buffer.from(cleaned, 'base64').toString('utf-8');
}

/**
 * Encodes content to base64 for GitHub API.
 */
export function encodeContent(content: string): string {
  // Use btoa for browser/worker environments, Buffer for Node
  if (typeof btoa === 'function') {
    return btoa(unescape(encodeURIComponent(content)));
  }
  return Buffer.from(content, 'utf-8').toString('base64');
}

/**
 * Creates or updates a file in the repository.
 *
 * If the file exists, the SHA must be provided.
 * If the file doesn't exist, SHA should be omitted.
 */
export async function createOrUpdateFile(
  config: GitHubClientConfig,
  path: string,
  content: string,
  message: string,
  existingSha?: string
): Promise<CommitResult> {
  validateConfig(config);

  const url = `${GITHUB_API_BASE}/repos/${config.target.owner}/${config.target.repo}/contents/${path}`;

  const body: Record<string, unknown> = {
    message,
    content: encodeContent(content),
    branch: config.target.branch,
  };

  if (existingSha) {
    body.sha = existingSha;
  }

  const response = await apiRequest<{
    content: { path: string; sha: string };
    commit: { sha: string; html_url: string };
  }>('PUT', url, config.token, body);

  return {
    sha: response.commit.sha,
    path: response.content.path,
    message,
    url: response.commit.html_url,
  };
}

/**
 * Creates a new file in the repository.
 * Fails if the file already exists.
 */
export async function createFile(
  config: GitHubClientConfig,
  path: string,
  content: string,
  message: string
): Promise<CommitResult> {
  // Check if file exists first
  const existing = await getFileContents(config, path);
  if (existing) {
    throw new GitHubAPIError(
      `File already exists: ${path}. Use updateFile to modify existing files.`,
      409
    );
  }

  return createOrUpdateFile(config, path, content, message);
}

/**
 * Updates an existing file in the repository.
 * Fails if the file doesn't exist.
 */
export async function updateFile(
  config: GitHubClientConfig,
  path: string,
  content: string,
  message: string
): Promise<CommitResult> {
  // Get existing file to retrieve SHA
  const existing = await getFileContents(config, path);
  if (!existing) {
    throw new GitHubAPIError(
      `File not found: ${path}. Use createFile to create new files.`,
      404
    );
  }

  return createOrUpdateFile(config, path, content, message, existing.sha);
}

/**
 * Creates or updates a file, automatically handling existence check.
 * This is the recommended method for write-back operations.
 */
export async function upsertFile(
  config: GitHubClientConfig,
  path: string,
  content: string,
  message: string
): Promise<CommitResult> {
  // Check if file exists to get SHA
  const existing = await getFileContents(config, path);
  return createOrUpdateFile(config, path, content, message, existing?.sha);
}

/**
 * Batch creates or updates multiple files.
 * Returns results for each file operation.
 *
 * Note: GitHub Contents API creates one commit per file.
 * For atomic multi-file commits, use the Git Trees API (not implemented).
 */
export async function batchUpsertFiles(
  config: GitHubClientConfig,
  files: Array<{ path: string; content: string; message: string }>
): Promise<CommitResult[]> {
  validateConfig(config);

  // Sort files for deterministic ordering
  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));

  const results: CommitResult[] = [];

  for (const file of sortedFiles) {
    try {
      const result = await upsertFile(config, file.path, file.content, file.message);
      results.push(result);
    } catch (err) {
      // Re-throw with file path context
      if (err instanceof GitHubAPIError) {
        throw new GitHubAPIError(
          `Failed to write ${file.path}: ${err.message}`,
          err.status,
          err.response
        );
      }
      throw err;
    }
  }

  return results;
}

/**
 * Tests that the GitHub token has write access to the target repository.
 * Returns true if write access is confirmed, throws on error.
 */
export async function verifyWriteAccess(config: GitHubClientConfig): Promise<boolean> {
  validateConfig(config);

  const url = `${GITHUB_API_BASE}/repos/${config.target.owner}/${config.target.repo}`;

  const response = await apiRequest<{
    permissions?: {
      push?: boolean;
      admin?: boolean;
    };
  }>('GET', url, config.token);

  if (!response.permissions?.push && !response.permissions?.admin) {
    throw new GitHubAPIError(
      'Token does not have write access to the repository',
      403
    );
  }

  return true;
}
