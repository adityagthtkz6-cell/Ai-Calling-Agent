// ============================================================
// URL Scraper
// Uses cheerio to extract clean body text from a URL.
// Strips nav, header, footer, scripts, ads.
// Falls back to raw text content if no <article> or <main>.
// ============================================================

export async function scrapeUrl(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; VoiceIntelligenceBot/1.0; +https://voiceintelligence.ai)",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`URL scrape failed: ${response.status} ${response.statusText} — ${url}`);
  }

  const html = await response.text();

  // Dynamic import — cheerio is server-only
  const { load } = await import("cheerio");
  const $ = load(html);

  // Remove noise elements
  $("script, style, nav, header, footer, aside, [role='banner'], [role='navigation'], [role='complementary'], .ad, .ads, .advertisement, .cookie-banner, noscript, iframe").remove();

  // Prefer semantic content containers
  const contentSelectors = ["article", "main", '[role="main"]', ".content", "#content", ".post-content", ".entry-content"];
  let text = "";

  for (const selector of contentSelectors) {
    const el = $(selector).first();
    if (el.length && el.text().trim().length > 200) {
      text = el.text();
      break;
    }
  }

  // Fallback to body
  if (!text) {
    text = $("body").text();
  }

  return cleanScrapedText(text);
}

function cleanScrapedText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+|\s+$/gm, "")
    .trim();
}
