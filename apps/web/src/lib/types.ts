/** Subset of RawJob for list view — no description/raw to keep payload small */
export interface JobSummary {
  externalId: string;
  url: string;
  title: string;
  company: string;
  companyLogoUrl?: string;
  location?: string;
  isRemote?: boolean;
  tags?: string[];
  salary?: {
    min?: number;
    max?: number;
    currency?: string;
  };
  postedAt?: string;
  applyUrl?: string;
}
