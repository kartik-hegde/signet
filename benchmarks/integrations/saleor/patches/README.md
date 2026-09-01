# Storefront patch

The numbered patch series is generated from the integration commits and applies to storefront
revision `56f021d42196eaa78b997df010430d8ea7842e99`:

```sh
git checkout 56f021d42196eaa78b997df010430d8ea7842e99
git am /path/to/signet/benchmarks/integrations/saleor/patches/000*.patch
```

The patched checkout expects the pinned sibling `signet` package declared in the
manifest. Run `npm run fixtures:materialize` from the monorepo root to create the
ignored `.external/signet` compatibility link before installing the storefront.
Keeping the patch here makes the benchmark reproducible without copying the Saleor
source tree into this repository.
