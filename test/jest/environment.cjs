const { default: TestEnvironment } = require("@jest/environment-jsdom-abstract");
// jsdom does not supply Node's Fetch API or text encoding globals.
module.exports = class BrowserEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context, require("jsdom"));
  }
  async setup() {
    await super.setup();
    // jsdom has no native modal/popover state. nwsapi delegates these selectors
    // back to Element.matches, which otherwise recursively calls itself.
    const matches = this.global.Element.prototype.matches;
    this.global.Element.prototype.matches = function (selector) {
      if (selector === ":modal" || selector === ":popover-open") return false;
      return matches.call(this, selector);
    };
    for (const key of [
      "Blob",
      "File",
      "structuredClone",
      "TextEncoder",
      "TextDecoder",
      "Request",
      "Response",
      "Headers",
      "ReadableStream",
      "TransformStream",
    ]) {
      this.global[key] = globalThis[key];
    }
  }
};
