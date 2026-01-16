/**
 * Path Contract
 *
 * Deterministic mapping from ingested URLs to target repository file paths.
 * Enforces a strict contract to ensure consistent, predictable file placement.
 *
 * SUPPORTED PROJECT TYPES:
 * - astro-pages: Astro project with src/pages structure
 * - static-html: Static HTML site with direct file structure
 *
 * SUPPORTED ROUTE STRATEGIES:
 * - path-index: URLs map to directory/index.ext structure
 * - flat-html: URLs map to flat file names with hyphen separators
 */

/**
 * Supported project types for target repository.
 */
export type ProjectType = 'astro-pages' | 'static-html';

/**
 * Supported route strategies for file mapping.
 */
export type RouteStrategy = 'path-index' | 'flat-html';

/**
 * Path contract configuration.
 */
export interface PathContractConfig {
  projectType: ProjectType;
  routeStrategy: RouteStrategy;
}

/**
 * Result of path mapping.
 */
export interface PathMappingResult {
  url: string;
  urlPath: string;
  filePath: string;
  fileExtension: string;
  isIndex: boolean;
}

/**
 * Error thrown when a URL cannot be mapped to a file path.
 */
export class PathMappingError extends Error {
  constructor(
    message: string,
    public readonly url: string,
    public readonly reason: string
  ) {
    super(message);
    this.name = 'PathMappingError';
  }
}

/**
 * Validates that the project type is supported.
 */
export function isValidProjectType(value: unknown): value is ProjectType {
  return value === 'astro-pages' || value === 'static-html';
}

/**
 * Validates that the route strategy is supported.
 */
export function isValidRouteStrategy(value: unknown): value is RouteStrategy {
  return value === 'path-index' || value === 'flat-html';
}

/**
 * Extracts and normalizes the path from a URL.
 */
function extractUrlPath(url: string): string {
  try {
    const parsed = new URL(url);
    let path = parsed.pathname;

    // Normalize: ensure no trailing slash except for root
    if (path !== '/' && path.endsWith('/')) {
      path = path.slice(0, -1);
    }

    // Remove any double slashes
    path = path.replace(/\/+/g, '/');

    return path;
  } catch {
    throw new PathMappingError(
      `Invalid URL: ${url}`,
      url,
      'URL parsing failed'
    );
  }
}

/**
 * Validates that a URL path is safe for file system mapping.
 */
function validatePathSafety(urlPath: string, url: string): void {
  // Reject paths with parent directory traversal
  if (urlPath.includes('..')) {
    throw new PathMappingError(
      `Unsafe path detected: ${urlPath}`,
      url,
      'Path contains directory traversal'
    );
  }

  // Reject paths with special characters that could cause issues
  const unsafeChars = /[<>:"|?*\\]/;
  if (unsafeChars.test(urlPath)) {
    throw new PathMappingError(
      `Unsafe characters in path: ${urlPath}`,
      url,
      'Path contains characters unsafe for file systems'
    );
  }

  // Reject excessively long paths
  if (urlPath.length > 200) {
    throw new PathMappingError(
      `Path too long: ${urlPath.length} characters`,
      url,
      'Path exceeds maximum safe length'
    );
  }
}

/**
 * Maps a URL path to a file path for astro-pages with path-index strategy.
 *
 * Examples:
 * - "/" -> "src/pages/index.astro"
 * - "/about" -> "src/pages/about/index.astro"
 * - "/services/plumbing" -> "src/pages/services/plumbing/index.astro"
 */
function mapAstroPagesPathIndex(urlPath: string): string {
  if (urlPath === '/' || urlPath === '') {
    return 'src/pages/index.astro';
  }

  // Remove leading slash
  const cleanPath = urlPath.replace(/^\//, '');
  return `src/pages/${cleanPath}/index.astro`;
}

/**
 * Maps a URL path to a file path for astro-pages with flat-html strategy.
 *
 * Examples:
 * - "/" -> "src/pages/index.astro"
 * - "/about" -> "src/pages/about.astro"
 * - "/services/plumbing" -> "src/pages/services-plumbing.astro"
 */
function mapAstroPagesFlat(urlPath: string): string {
  if (urlPath === '/' || urlPath === '') {
    return 'src/pages/index.astro';
  }

  // Remove leading slash and replace remaining slashes with hyphens
  const cleanPath = urlPath.replace(/^\//, '').replace(/\//g, '-');
  return `src/pages/${cleanPath}.astro`;
}

/**
 * Maps a URL path to a file path for static-html with path-index strategy.
 *
 * Examples:
 * - "/" -> "index.html"
 * - "/about" -> "about/index.html"
 * - "/services/plumbing" -> "services/plumbing/index.html"
 */
function mapStaticHtmlPathIndex(urlPath: string): string {
  if (urlPath === '/' || urlPath === '') {
    return 'index.html';
  }

  // Remove leading slash
  const cleanPath = urlPath.replace(/^\//, '');
  return `${cleanPath}/index.html`;
}

/**
 * Maps a URL path to a file path for static-html with flat-html strategy.
 *
 * Examples:
 * - "/" -> "index.html"
 * - "/about" -> "about.html"
 * - "/services/plumbing" -> "services-plumbing.html"
 */
function mapStaticHtmlFlat(urlPath: string): string {
  if (urlPath === '/' || urlPath === '') {
    return 'index.html';
  }

  // Remove leading slash and replace remaining slashes with hyphens
  const cleanPath = urlPath.replace(/^\//, '').replace(/\//g, '-');
  return `${cleanPath}.html`;
}

/**
 * Maps a URL to a deterministic file path based on project configuration.
 *
 * @param url - The full URL to map (must be a valid URL)
 * @param config - The path contract configuration
 * @returns PathMappingResult with the mapped file path
 * @throws PathMappingError if the URL cannot be safely mapped
 */
export function mapUrlToFilePath(
  url: string,
  config: PathContractConfig
): PathMappingResult {
  // Extract and validate the URL path
  const urlPath = extractUrlPath(url);
  validatePathSafety(urlPath, url);

  // Determine file path based on project type and route strategy
  let filePath: string;
  let fileExtension: string;

  if (config.projectType === 'astro-pages') {
    fileExtension = 'astro';
    if (config.routeStrategy === 'path-index') {
      filePath = mapAstroPagesPathIndex(urlPath);
    } else {
      filePath = mapAstroPagesFlat(urlPath);
    }
  } else {
    // static-html
    fileExtension = 'html';
    if (config.routeStrategy === 'path-index') {
      filePath = mapStaticHtmlPathIndex(urlPath);
    } else {
      filePath = mapStaticHtmlFlat(urlPath);
    }
  }

  // Determine if this is an index file
  const isIndex = filePath.endsWith('/index.astro') ||
                  filePath.endsWith('/index.html') ||
                  filePath === 'index.html' ||
                  filePath === 'src/pages/index.astro';

  return {
    url,
    urlPath,
    filePath,
    fileExtension,
    isIndex,
  };
}

/**
 * Maps multiple URLs to file paths, collecting errors for any that fail.
 *
 * @param urls - Array of URLs to map
 * @param config - The path contract configuration
 * @returns Object with successful mappings and errors
 */
export function mapUrlsToFilePaths(
  urls: string[],
  config: PathContractConfig
): {
  mappings: PathMappingResult[];
  errors: Array<{ url: string; error: string }>;
} {
  const mappings: PathMappingResult[] = [];
  const errors: Array<{ url: string; error: string }> = [];

  // Sort URLs for deterministic output
  const sortedUrls = [...urls].sort();

  for (const url of sortedUrls) {
    try {
      const mapping = mapUrlToFilePath(url, config);
      mappings.push(mapping);
    } catch (err) {
      if (err instanceof PathMappingError) {
        errors.push({ url: err.url, error: err.reason });
      } else {
        errors.push({ url, error: 'Unknown mapping error' });
      }
    }
  }

  return { mappings, errors };
}

/**
 * Validates a PathContractConfig object.
 */
export function validatePathContractConfig(
  config: unknown
): config is PathContractConfig {
  if (!config || typeof config !== 'object') {
    return false;
  }

  const c = config as Record<string, unknown>;
  return isValidProjectType(c.projectType) && isValidRouteStrategy(c.routeStrategy);
}
