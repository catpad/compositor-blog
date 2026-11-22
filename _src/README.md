# How this site is made

The site in the repository root is generated. Do not edit `index.html`, `p/`, `feed.xml` by hand: change the inputs in `_src/` and run

    node _src/build.mjs

The posts are written in Compositor, a Claude artifact (slug `64cf1e8f-12fd-4af1-b34e-63eea23d5307`). This repository is its public, read-only copy.

## Bringing new posts over

1. List the artifact's `posts` collection and read `site/config` (the default home style).
2. Rewrite `data/posts.json`: one record per post with `id`, `kind`, `title`, `summary`, `theme`, `status`, `createdAt`, `publishedAt` and `asset` (the asset of the version numbered `current`). Only posts with `status: "published"` reach the site. Put `site/config.theme` into `site.theme`.
3. For every published post whose `asset` changed, save that asset's text to `pages/<id>.html`, byte for byte, and check its SHA-256 against the one the artifact reports for the asset. A page that does not match must not be published.
   Posts of kind `plain` need no page file: copy their `source` blocks into the record instead, and the build sets them with Compositor's own code. Add the asset's `sha256` to the record and the build will confirm the result is identical.
4. A page may refer to stored files as `/_blob/<assetid>`. Save each such asset as `files/<assetid>.<ext>`; the build copies it and rewrites the address. The build lists any that are missing.
5. Run the build, open a few pages, commit and push. GitHub Pages serves the root of `main`.

Remove a post from the site by deleting its record (and its page file) and building again.

## What the build changes in a page

- adds the thin bar with the link home, the canonical address, the feed link and sharing tags;
- points `fonts/` and sibling files at the site root;
- replaces the placeholder cards of YouTube videos and posts on X with the real players, which the open web allows and the artifact does not.

Everything else is left exactly as stored.

## The home page

`compositor/index.src.html` is a copy of the Compositor source. The home page takes its styles, its list of styles and its drawing code from that file, so replacing the copy with a newer one carries any change of the home page over. The discussion threads, the owner's buttons and drafts are not part of the site.
