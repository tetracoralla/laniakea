# Third-party software

Laniakea builds on third-party open-source software. The authoritative dependency versions are recorded in `package-lock.json` and `src-tauri/Cargo.lock`; each installed package or crate carries its own license text and copyright notices.

Major direct runtime dependencies include:

| Project | Purpose | License |
| --- | --- | --- |
| React and React DOM | User interface | MIT |
| IconPark | User interface icon geometry | Apache-2.0 |
| Tauri and Tauri API | Desktop application runtime | Apache-2.0 OR MIT |
| Tauri Dialog Plugin | Native file dialogs | MIT OR Apache-2.0 |
| unified / remark / mdast utilities | Markdown parsing and serialization | MIT |
| serde / serde_json | Rust serialization | MIT OR Apache-2.0 |
| sha2 | Content hashing | MIT OR Apache-2.0 |

The Web build emits `LICENSE`, `NOTICE`, and `THIRD_PARTY_NOTICES.txt` from the
exact modules included in the frontend. The standalone Codex Plugin carries
its own generated notices inside `plugins/laniakea`.

The desktop build also runs `npm run build:desktop-notices`. It collects the
locked macOS Cargo dependency graphs, including build dependencies, and
preserves their license texts, package authors and unchanged source archive
links. Versioned upstream supplements for crates that omit license files are
documented in `licenses/rust/README.md`. Missing or changed supplements fail
the build. The `.app` contains the project license and both frontend and
native notices under `Contents/Resources/licenses`.
