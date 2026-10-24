# ops/oci

Provisioning and the launch retry. The inventory, the IAM split and the extraction record
are in [`../../docs/oci.md`](../../docs/oci.md).

| File | What it is |
| --- | --- |
| `launch.sh` | `CB_OCI_*` retry loop: one `launch` call per attempt, parks on a `RUNNING` `cb-instance`, reports `id` / `ip` / `shape`. `--dry-run` validates without calling OCI. |
| `README.md` | This map. |

The workflow that drives it is [`.github/workflows/oci-retry.yml`](../../.github/workflows/oci-retry.yml).
It is the only writer of the chain: do not run a second loop against the same tenancy, both
would share one launch rate limiter.

## Operating it

```bash
# Validate the configuration without calling OCI
CB_OCI_COMPARTMENT_ID=... CB_OCI_SUBNET_ID=... CB_OCI_IMAGE_ID=... CB_OCI_AD=... \
CB_OCI_SSH_PUBLIC_KEY=... OCI_CLI_USER=... OCI_CLI_FINGERPRINT=... OCI_CLI_TENANCY=... \
OCI_CLI_REGION=... OCI_CLI_KEY_CONTENT=... bash ops/oci/launch.sh --dry-run

# Brake the chain: the runs stay green and do nothing
gh variable set CB_OCI_RETRY --body off

# Re-arm it
gh variable set CB_OCI_RETRY --body on
```

A stopped instance is not `RUNNING`: brake the chain before stopping or resizing it, or the
next run reads the box as gone and launches a second one beside it (`docs/oci.md` §6).
