type CssModule = Readonly<Record<string, string>>;

/**
 * Resolves classes from a shared CSS Module and a component-owned CSS Module.
 *
 * CSS Module objects are enumerable in the browser build but intentionally are
 * not enumerable in Next's Jest transform, so object spread is not portable.
 * Keeping the owned class names explicit also makes the stylesheet boundary
 * reviewable. Classes present in both modules are composed at access time.
 */
export function mergeCssModuleStyles(
  sharedStyles: CssModule,
  localStyles: CssModule,
  localClassNames: readonly string[],
  combinedClassNames: readonly string[] = [],
): CssModule {
  const localClasses = new Set(localClassNames);
  const combinedClasses = new Set(combinedClassNames);

  return new Proxy(Object.create(null) as Record<string, string>, {
    get(_target, property: string | symbol): string | undefined {
      if (typeof property !== "string") return undefined;

      if (combinedClasses.has(property)) {
        return [sharedStyles[property], localStyles[property]].filter(Boolean).join(" ");
      }

      return localClasses.has(property) ? localStyles[property] : sharedStyles[property];
    },
  });
}
