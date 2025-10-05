// lib/domainConfig.ts
export interface DomainConfig {
  domain: string;
  table: string;
  prefix?: string;
  displayName: string;
  description?: string;
}

export const DOMAIN_CONFIGS: DomainConfig[] = [
  {
    domain: 'shortly.pp.ua',
    table: 'links_shortly',
    prefix: 'sh',
    displayName: 'Shortly',
        description: '', // Provide an empty string or your desired description
      }
    ];