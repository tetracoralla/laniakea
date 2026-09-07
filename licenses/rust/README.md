# Native license supplements

Some crates omit their repository's license files from the published archive.
`supplements.json` binds these retained upstream files to each exact crate
version, upstream commit and SHA-256. The source URLs are recorded alongside
each file. `selectors` points to the full MPL 2.0 text supplied by Mozilla;
its source files declare that license.

`npm run build:desktop-notices` uses Cargo's locked macOS dependency graphs,
prefers the license and notice files in each crate, and verifies these
supplements only where the archive has no such file. A missing supplement or
changed version, commit or digest fails the build. Review new dependencies
before extending this collection. Generated notices include source archive
links and package attribution; they do not alter the dependencies' licenses.

For objc2-family crates, upstream LICENSE.md declares licensing but links to
the standard texts. The accompanying MIT text is retained from the SPDX
license list at an exact commit; the notice preserves upstream authors and
declarations without inventing a copyright year or holder.
