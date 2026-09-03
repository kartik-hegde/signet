import DefaultTheme from "vitepress/theme";
import { inBrowser, type Theme } from "vitepress";
import "./signett.css";

let webMcpRegistration:
  | Promise<import("./webmcp").DocsWebMcpRegistration>
  | undefined;

export default {
  extends: DefaultTheme,
  enhanceApp({ siteData }) {
    if (!inBrowser) return;

    webMcpRegistration ??= import("./webmcp").then(
      async ({ registerDocsWebMcp }) =>
        await registerDocsWebMcp({ base: siteData.value.base }),
    );
    void webMcpRegistration.catch((error: unknown) => {
      console.error("Signett docs could not register their WebMCP tools.", error);
    });
  },
} satisfies Theme;
