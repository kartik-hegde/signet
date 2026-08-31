/** The equivalent application adapter when the execution controls come from Signet. */
export function buildWithSignet({ handler, store, key, verify, guard }) {
  return guard(handler, {
    idempotency: {
      key: ({ input }) => key(input),
      store,
    },
    ...(verify
      ? {
          verify: ({ input, output, replayed }) =>
            verify({ input, output, replayed }),
        }
      : {}),
  });
}
