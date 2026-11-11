# Body twin: sources and licences

Checked 11 Nov 2026. The two meshes in `packages/web/src/growth/assets/twin-{female,male}.bin` are built by our own code
(`tools/growth-twin/build.mjs`) from MakeHuman asset data only. No MakeHuman program code (AGPL) is used, copied or run.

| File (downloaded to `C:\Users\doruk\apps\_media\ba-growth\makehuman\`, not in the repository) | Source |
|---|---|
| `base.obj` (hm08 base mesh; the `body` group only) | https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data/3dobjs/base.obj |
| `{african,asian,caucasian}-{female,male}-young.target` (macro shape, 1/3 each) | https://github.com/makehumancommunity/makehuman/tree/master/makehuman/data/targets/macrodetails |
| `default_weights.mhw` (rig weights, used to split the body into regions) | https://github.com/makehumancommunity/makehuman/tree/master/makehuman/data/rigs |

Licence evidence (read on 11 Nov 2026):
- Repository licence, section C: "The assets are defined as any data contributing to the graphical output of MakeHuman.
  This includes: The base mesh and proxies, Targets and modifiers, ... These assets have been released under CC0 1.0
  Universal." https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.md (full text: LICENSE.ASSETS.md)
- Every target file says "This asset was explicitly released as CC0 in september 2020"; `default_weights.mhw` declares
  `"license": "CC0"`.

CC0 needs no attribution. The processing (regions, smoothed face and hands, tape bands, quantised binary) is ours; the
shaping at run time (`packages/core/growth/twin/deform.ts`) is our own code, written for this project. The approach
(a CC0 base mesh shaped by tape circumferences) follows the idea of Leano 2.0's twin; no Leano code or asset was copied.

Runtime library: three 0.170.0 (MIT), already a dependency of the games.
