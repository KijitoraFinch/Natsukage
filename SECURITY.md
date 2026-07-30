# Security

## Trusting a deployment

Natsukage handles SSH passwords, private keys, and private-key passphrases in
the browser. The application does not persist these credentials, but code
served by a compromised or untrusted web origin could read them while they are
entered.

Only use a deployment whose source and build process you trust. For the
strongest control over the delivery path, fork this repository and deploy it
from your own GitHub Actions run or build and host `dist/` yourself.

## Source-built Tailscale client

Generated Tailscale Connect JavaScript and WebAssembly are excluded from Git.
`npm run build` fetches one pinned Tailscale commit, checks and applies the
reviewable patch in `patches/`, and builds the client with the Go and Binaryen
versions pinned by that Tailscale source tree.

The distribution includes:

- the exact upstream repository and commit;
- the patch and its SHA-256 digest;
- the pinned Go toolchain and Binaryen versions; and
- SHA-256 digests for the generated WebAssembly, JavaScript, and CSS.

See `dist/source/` after a production build.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for issues that could
expose credentials, Tailnet traffic, saved Tailscale state, or host identity.
Do not include real credentials or private keys in a public issue.
