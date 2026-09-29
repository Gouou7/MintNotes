import { describe, expect, it } from "vitest";
import { markdownImages, rewriteMarkdownImages } from "./markdownImages";

describe("portable Markdown image references", () => {
  it("changes only image destinations, preserving code, prose, front matter and CRLF", () => {
    const source = '---\r\nimage: "![hidden](a.png)"\r\n---\r\nplain a.png data.png\r\n`![code](a.png)`\r\n```md\r\n![code](a.png)\r\n```\r\n![image](a.png "title") [link](a.png)\r\n';
    const images = markdownImages(source);
    expect(images).toHaveLength(1);
    expect(rewriteMarkdownImages(source, new Map([[images[0], "webmd-attachment:id"]]))).toBe(source.replace('![image](a.png', '![image](<webmd-attachment:id>'));
  });
  it("supports nested parentheses, escaped labels and angle destinations", () => {
    const source = '![a\\]b](a(b).png) ![c](<a b.png>)';
    expect(markdownImages(source).map((image) => image.url)).toEqual(['a(b).png', 'a b.png']);
    const images = markdownImages(source);
    expect(rewriteMarkdownImages(source, new Map(images.map((image) => [image, './new.png'])))).toBe('![a\\]b](<./new.png>) ![c](<./new.png>)');
  });
  it("splits image definitions shared with ordinary links without rewriting either label", () => {
    const source = '![image][same] [ordinary][same]\r\n\r\n[same]: <a.png> "title"\r\n';
    const images = markdownImages(source);
    const rewritten = rewriteMarkdownImages(source, new Map([[images[0], './_attachments/a.png']]));
    expect(rewritten).toContain('[ordinary][same]');
    expect(rewritten).toContain('[same]: <a.png> "title"\r\n');
    expect(rewritten).toContain('![image][mint-image-1]');
    expect(rewritten).toContain('[mint-image-1]: <./_attachments/a.png> "title"');
    expect(markdownImages(rewritten)[0].url).toBe('./_attachments/a.png');
  });
  it("does not rewrite links nested inside the image description", () => {
    const source = '![outer [inner](inner.png)](outer.png)';
    const images = markdownImages(source);
    expect(rewriteMarkdownImages(source, new Map([[images[0], './new.png']]))).toBe('![outer [inner](inner.png)](<./new.png>)');
  });
  it("rewrites an image-only shared definition once, including shortcut references", () => {
    const source = '![same] ![same][]\n\n[same]: a.png\n';
    const images = markdownImages(source);
    expect(images).toHaveLength(2);
    expect(rewriteMarkdownImages(source, new Map(images.map((image) => [image, './new.png'])))).toBe(source.replace('a.png', '<./new.png>'));
  });
});
