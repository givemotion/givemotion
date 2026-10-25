# Third-party notices

givemotion's own code is under the MIT license (see `LICENSE`). It contains no code copied from other
video frameworks. This file lists everything else that ships with it or that it uses.

## Bundled in this repository and the npm package

### Fonts (SIL Open Font License 1.1)

The font files in `src/runtime/fonts/` are unmodified web-font files (latin and latin-ext subsets, as
distributed by Google Fonts / Fontsource). Each family's full license is next to the files.

| Font | Copyright | License file |
|---|---|---|
| Inter | 2016 The Inter Project Authors (https://github.com/rsms/inter) | `src/runtime/fonts/Inter-OFL.txt` |
| JetBrains Mono | 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono) | `src/runtime/fonts/JetBrainsMono-OFL.txt` |
| Playfair Display | 2017 The Playfair Display Project Authors (https://github.com/clauseggers/Playfair-Display), Reserved Font Name "Playfair Display" | `src/runtime/fonts/PlayfairDisplay-OFL.txt` |
| Space Grotesk | 2020 The Space Grotesk Project Authors (https://github.com/floriankarsten/space-grotesk) | `src/runtime/fonts/SpaceGrotesk-OFL.txt` |
| Bebas Neue | 2019 The Bebas Neue Project Authors (https://github.com/dharmatype/Bebas-Neue) | `src/runtime/fonts/BebasNeue-OFL.txt` |
| Caveat | 2014 The Caveat Project Authors (https://github.com/googlefonts/caveat) | `src/runtime/fonts/Caveat-OFL.txt` |

The OFL lets you use these fonts in videos you make, including commercial ones. The fonts may not be sold on
their own.

### Example media

The music, logos, images and data in `examples/` and `docs/media/` were made for this project and are covered by
the MIT license in `LICENSE`. The brands in the examples ("Flowline", the coffee shop) are made up.

## Optional npm dependencies (not bundled, installed only if present)

| Package | License | Used for |
|---|---|---|
| `react`, `react-dom` | MIT | React compositions |
| `esbuild` | MIT | Compiling `.jsx` / `.tsx` compositions |

## Used at run time, installed separately

givemotion does not include or redistribute these. It runs them as separate programs, under their own licenses.

| Program | License | Notes |
|---|---|---|
| Chrome / Chrome for Testing / Chromium | Google Chrome terms / BSD-3-Clause and others (Chromium) | Found on your system, or downloaded from Google by `givemotion install` |
| FFmpeg | LGPL 2.1+ or GPL 2+, depending on how your copy was built | Must be on your `PATH` |
| lottie-web | MIT | Loaded by the `lottie` block from a CDN (`cdn.jsdelivr.net`) when you use it; you can point it at your own copy |

Video codecs such as H.264 and H.265 may be covered by patents in some countries. givemotion does not ship
an encoder; the one in your FFmpeg build (or your operating system's hardware encoder) does the encoding, under
whatever terms apply to it.
