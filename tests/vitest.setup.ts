// Happy DOM does not implement the Web Animations API used by Base UI.
if (typeof Element !== "undefined") {
  Element.prototype.getAnimations ??= () => [];
}
