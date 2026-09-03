/** The equivalent application adapter when the execution controls come from Signett. */
export function buildWithSignett({ handler, store, journal, key, validate, recover, verify, guard }) {
  return guard(handler, {
    validate,
    idempotency: {
      key: ({ input }) => key(input),
      store,
    },
    journal: { store: journal },
    ...(recover ? { recover } : {}),
    ...(verify
      ? {
          verify: ({ input, output, replayed }) =>
            verify({ input, output, replayed }),
        }
      : {}),
  });
}
