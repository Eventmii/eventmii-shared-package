# eventmii-shared

Code shared between the Eventmii apps: block documents, renderers and helpers. Used by `eventmii-admin-dashboard`, `eventmii-node-servers` and `eventmii-guest-app-site`.

Entry points: `eventmii-shared/blocks`, `eventmii-shared/blocks/email-mjml`, `eventmii-shared/blocks/react`.

## Using a new version

The apps depend on an exact commit of this repository, not a version number.

1. Commit and push this repository.
2. In each app's `package.json`, change the commit hash in two places: the `eventmii-shared` dependency and the matching `allowScripts` entry.
3. Run `npm install` in each app.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

## Documentation

How the block builder works across the apps is described in `eventmii-documentation/features/block-builder.md`.
