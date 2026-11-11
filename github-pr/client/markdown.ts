/**
 * Paseo's Markdown renders images at their natural size, so bot badges and logos
 * (Vercel, Linear, Codecov…) blow up. Replace images with their alt text and drop
 * HTML comments and <picture> wrappers.
 */
export function sanitizeMarkdown(source: string): string {
  return (
    source
      .replace(/<!--[\s\S]*?-->/g, "")
      // Link reference definitions ("[vc]: #…") are invisible metadata.
      .replace(/^ {0,3}\[[^\]]+\]:\s.*$/gm, "")
      .replace(/<picture>[\s\S]*?<\/picture>/gi, "")
      .replace(/<source\b[^>]*>/gi, "")
      // <img alt="x" ...> → x
      .replace(/<img\b[^>]*>/gi, (tag) => {
        const alt = /\balt\s*=\s*"([^"]*)"|\balt\s*=\s*'([^']*)'/i.exec(tag);
        return (alt?.[1] ?? alt?.[2] ?? "").trim();
      })
      // [![alt](img)](link) → [alt](link)
      .replace(/\[!\[([^\]]*)\]\([^)]*\)\]\(([^)]*)\)/g, (_m, alt: string, link: string) =>
        alt.trim() ? `[${alt}](${link})` : "",
      )
      // ![alt](img) → alt
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => alt)
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
