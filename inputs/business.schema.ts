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
    testimonials?: {
      text: string;
      customerName?: string;
      serviceReceived?: string;
      date?: string;
      outcome?: string;
    }[];
  };

  team?: {
    members: {
      name: string;
      role: string;
      yearsExperience?: number;
      licenses?: string[];
      certifications?: string[];
      specialties?: string[];
      bio?: string;
      photoUrl?: string;
    }[];
  };

  operations?: {
    operatingHours?: string;
    emergencyService?: boolean;
    serviceProcess?: {
      steps: {
        title: string;
        description: string;
        timeline: string;
      }[];
      totalTimeline?: string;
      emergencyAvailable?: boolean;
      emergencyTimeline?: string;
    };
  };

  caseStudies?: {
    studies: {
      title: string;
      challenge: string;
      solution: string;
      results: {
        metric: string;
        value: string;
      }[];
      projectType: string;
      location: string;
      clientName?: string;
    }[];
  };

  constraints: {
    noHallucinations: true;
    allowedSources?: string[];
  };
}
