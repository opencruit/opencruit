export interface HhEmployer {
  id: string;
  name: string;
  logo_urls?: {
    original?: string;
    '90'?: string;
    '240'?: string;
  };
}

export interface HhArea {
  id: string;
  name: string;
}

export interface HhSchedule {
  id: string;
  name: string;
}

export interface HhSalary {
  from: number | null;
  to: number | null;
  currency: string;
  gross?: boolean;
}

export interface HhProfessionalRole {
  id: string;
  name: string;
}

export interface HhSearchVacancyItem {
  id: string;
  name: string;
  url: string;
  alternate_url: string;
  published_at: string;
  created_at: string;
  archived: boolean;
  employer?: HhEmployer;
  area?: HhArea;
  schedule?: HhSchedule;
  professional_roles?: HhProfessionalRole[];
}

export interface HhSearchResponse {
  items: HhSearchVacancyItem[];
  found: number;
  pages: number;
  page: number;
  per_page: number;
}

export interface HhKeySkill {
  name: string;
}

export interface HhWorkFormat {
  id: string;
  name: string;
}

export interface HhVacancyAddress {
  city?: string;
  raw?: string;
}

export interface HhVacancyDetail {
  id: string;
  name: string;
  description: string;
  archived: boolean;
  published_at: string;
  alternate_url: string;
  apply_alternate_url?: string | null;
  employer?: HhEmployer;
  area?: HhArea;
  address?: HhVacancyAddress | null;
  schedule?: HhSchedule;
  salary?: HhSalary | null;
  salary_range?: HhSalary | null;
  key_skills?: HhKeySkill[];
  professional_roles?: HhProfessionalRole[];
  work_format?: HhWorkFormat[];
}

export interface HhProfessionalRoleCategory {
  id: string;
  name: string;
  roles: HhProfessionalRole[];
}

export interface HhProfessionalRolesResponse {
  categories: HhProfessionalRoleCategory[];
}

export interface HhSearchParams {
  professionalRole: string;
  page?: number;
  perPage?: number;
  dateFrom?: string;
  dateTo?: string;
  host?: string;
  orderBy?: 'publication_time' | 'relevance';
}
