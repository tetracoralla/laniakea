# Third-party software

Laniakea builds on third-party open-source software. The authoritative dependency versions are recorded in `package-lock.json` and `src-tauri/Cargo.lock`; each installed package or crate carries its own license text and copyright notices.

Major direct runtime dependencies include:

| Project | Purpose | License |
| --- | --- | --- |
| React and React DOM | User interface | MIT |
| Tauri and Tauri API | Desktop application runtime | Apache-2.0 OR MIT |
| Tauri Dialog Plugin | Native file dialogs | MIT OR Apache-2.0 |
| unified / remark / mdast utilities | Markdown parsing and serialization | MIT |
| serde / serde_json | Rust serialization | MIT OR Apache-2.0 |
| sha2 | Content hashing | MIT OR Apache-2.0 |

Development-only dependencies are not shipped as standalone components of the application but remain governed by their respective licenses. Before distributing a release artifact, regenerate or review the complete dependency inventory from the two lockfiles and preserve any package-specific notice files required by the selected license option.
