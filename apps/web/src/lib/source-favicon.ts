import { parse as parseDomain } from "tldts";

const RAW_HOSTS = new Set([
  "raw.githubusercontent.com",
  "cdn.jsdelivr.net",
  "unpkg.com",
  "raw.github.com",
]);

// ---------------------------------------------------------------------------
// Google product icon URLs (official CDN assets)
// ---------------------------------------------------------------------------

const GOOGLE_SERVICE_ICONS: Record<string, string> = {
  calendar: "https://ssl.gstatic.com/calendar/images/dynamiclogo_2020q4/calendar_31_2x.png",
  drive: "https://ssl.gstatic.com/images/branding/product/2x/drive_2020q4_48dp.png",
  gmail: "https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico",
  docs: "https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico",
  sheets: "https://ssl.gstatic.com/docs/spreadsheets/favicon3.ico",
  slides: "https://ssl.gstatic.com/docs/presentations/images/favicon5.ico",
  forms: "https://ssl.gstatic.com/docs/forms/device_home/android_192.png",
  searchconsole: "https://ssl.gstatic.com/search-console/scfe/search_console-64.png",
  people: "https://ssl.gstatic.com/images/branding/product/2x/contacts_2022_48dp.png",
  tasks: "https://ssl.gstatic.com/tasks/images/favicon.ico",
  chat: "https://ssl.gstatic.com/chat/favicon/favicon_v2.ico",
  keep: "https://ssl.gstatic.com/keep/icon_2020q4v2_128.png",
  classroom: "https://ssl.gstatic.com/classroom/favicon.png",
  admin: "https://ssl.gstatic.com/images/branding/product/2x/admin_2020q4_48dp.png",
  script: "https://ssl.gstatic.com/script/images/favicon.ico",
  bigquery: "https://ssl.gstatic.com/bqui1/favicon.ico",
  cloudresourcemanager: "https://www.gstatic.com/devrel-devsite/prod/v0e0f589edd85502a40d78d7d0825db8ea5ef3b99b1571571945f0f3f764ff61b/cloud/images/favicons/onecloud/favicon.ico",
  youtube: "https://www.youtube.com/s/desktop/a94e1818/img/favicon_32x32.png",
};

/**
 * For google_discovery endpoints, extract the service name and return
 * the official product icon URL if we have one.
 */
const getGoogleServiceIconUrl = (endpoint: string | null | undefined): string | null => {
  if (!endpoint) return null;
  try {
    const url = new URL(endpoint);
    const host = url.hostname;

    // Direct service subdomain: "calendar-json.googleapis.com", "gmail.googleapis.com"
    if (host.endsWith(".googleapis.com")) {
      const sub = host.replace(/\.googleapis\.com$/, "").replace(/-json$/, "");
      if (GOOGLE_SERVICE_ICONS[sub]) return GOOGLE_SERVICE_ICONS[sub];
    }

    // Discovery URL pattern: /discovery/v1/apis/{service}/{version}/rest
    const discoveryMatch = url.pathname.match(/\/apis\/([^/]+)\//);
    if (discoveryMatch?.[1] && GOOGLE_SERVICE_ICONS[discoveryMatch[1]]) {
      return GOOGLE_SERVICE_ICONS[discoveryMatch[1]];
    }

    // $discovery/rest pattern on service subdomains is already handled above
  } catch {
    // fall through
  }
  return null;
};

// ---------------------------------------------------------------------------
// General favicon resolution
// ---------------------------------------------------------------------------

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

export const getGoogleProductIconUrl = getGoogleServiceIconUrl;

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
