import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      // compositor.ts assigns plain data properties (getWidth/renderBand) and
      // aliases `this` while monkey-patching a foreign object's methods, not
      // calling unbound class methods.
      "typescript/unbound-method": "off",
      "typescript/no-this-alias": "off",
    },
    options: { typeAware: true, typeCheck: true },
  },
});
