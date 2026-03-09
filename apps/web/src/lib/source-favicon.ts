import { parse as parseDomain } from "tldts";

const RAW_HOSTS = new Set([
  "raw.githubusercontent.com",
  "cdn.jsdelivr.net",
  "unpkg.com",
  "raw.github.com",
]);

const parseUrl = (value: string | null | undefined): URL | null => {
  if (!value) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const normalizeSeedUrl = (value: string | null | undefined): string | null => {
  const parsed = parseUrl(value);
  if (!parsed) {
    return null;
  }

  if (!RAW_HOSTS.has(parsed.hostname)) {
    return parsed.origin;
  }

  const segments = parsed.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  for (const segment of segments) {
    const withoutExtension = segment.replace(/\.(ya?ml|json)$/i, "");
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(withoutExtension)) {
      return `https://${withoutExtension}`;
    }
  }

  return parsed.origin;
};

export const getSourceFaviconUrl = (
  value: string | null | undefined,
): string | null => {
  const seedUrl = normalizeSeedUrl(value);
  if (!seedUrl) {
    return null;
  }

  try {
    const hostname = new URL(seedUrl).hostname;
    const parsed = parseDomain(hostname);
    const domain = parsed.domain ?? hostname;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
  } catch {
    return null;
  }
};
