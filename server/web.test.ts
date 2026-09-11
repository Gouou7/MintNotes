import { describe, expect, it } from "vitest";
import { staticCacheControl } from "./web";

describe("web asset caching", () => {
  it("caches content-hashed assets immutably", () => {
    expect(staticCacheControl("/app/dist/assets/index-AbCd1234.js"))
      .toBe("public, max-age=31536000, immutable");
    expect(staticCacheControl("C:\\app\\dist\\assets\\index-AbCd1234.css"))
      .toBe("public, max-age=31536000, immutable");
  });

  it("revalidates the app shell and service worker", () => {
    expect(staticCacheControl("/app/dist/index.html"))
      .toBe("public, max-age=0, must-revalidate");
    expect(staticCacheControl("/app/dist/sw.js"))
      .toBe("public, max-age=0, must-revalidate");
  });
});
