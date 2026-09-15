import { setextUnderline } from "micromark-core-commonmark";
import type { Construct, Extension } from "micromark-util-types";

// Keep micromark's container handling and source positions, but reject short
// underlines during tokenization so later lines can still join the paragraph.
const strictSetextUnderline: Construct = {
  ...setextUnderline,
  name: "mintSetextUnderline",
  tokenize(effects, ok, nok) {
    let markers = 0;
    return setextUnderline.tokenize.call(this, {
      ...effects,
      consume(code) {
        if (code === 45 || code === 61) markers++;
        effects.consume(code);
      },
    }, (code) => markers >= 3 ? ok(code) : nok(code), nok);
  },
};

export function remarkReadingSetext(this: { data(): unknown }): void {
  const data = this.data() as { micromarkExtensions?: Extension[] };
  const extensions = data.micromarkExtensions ?? (data.micromarkExtensions = []);
  extensions.push({
    disable: { null: ["setextUnderline"] },
    flow: { 45: strictSetextUnderline, 61: strictSetextUnderline },
  });
}
