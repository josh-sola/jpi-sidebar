/** Narrow view of pi's Theme used by panel renderers, so panels don't depend on the full Theme type. */
export interface ThemeLike {
  fg(color: string, text: string): string;
  bold(text: string): string;
}
