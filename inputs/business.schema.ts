export interface BusinessInput {
  business: {
    name: string;
    legalName?: string;
    website?: string;
    domain?: string;
  };

  location: {
    primaryCity: string;
    region?: string;
    country: string;
    serviceAreas: string[];
  };

  contact: {
    phone?: string;
    email?: string;
  };

  services: {
    primary: string[];
    secondary?: string[];
  };

  credentials?: {
    yearsOperating?: number;
    licenses?: string[];
    insurance?: string;
    certifications?: string[];
  };

  proof?: {
    reviewCount?: number;
    averageRating?: number;
    testimonialsAvailable?: boolean;
    caseStudiesAvailable?: boolean;
  };

  operations?: {
    operatingHours?: string;
    emergencyService?: boolean;
  };

  constraints: {
    noHallucinations: true;
    allowedSources?: string[];
  };
}
