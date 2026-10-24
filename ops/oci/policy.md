# IAM for the `cb-*` resources

Two principals, two policies, no overlap. The statements below are copied verbatim from
[`../../docs/oci.md`](../../docs/oci.md) §2, in the same order; this file adds no grant and
narrows none.

## `cb-ci` — provisioning, from GitHub Actions

The API user the OCI CLI authenticates as (`OCI_CLI_USER`), with a key held as the
`OCI_CLI_KEY_CONTENT` secret.

```
Allow group cb-ci to manage instances in tenancy
Allow group cb-ci to use volumes in tenancy
Allow group cb-ci to use vnics in tenancy
Allow group cb-ci to use private-ips in tenancy
Allow group cb-ci to use public-ips in tenancy
Allow group cb-ci to use subnets in tenancy
Allow group cb-ci to use vcns in tenancy
Allow group cb-ci to use security-lists in tenancy
Allow group cb-ci to use route-tables in tenancy
Allow group cb-ci to use internet-gateways in tenancy
Allow group cb-ci to read instance-images in tenancy
```

## `cb-instance` — runtime, through the instance principal

`<compartment>` is the placeholder for the compartment OCID, which is
`CB_OCI_COMPARTMENT_ID` (`docs/providers.md` §12). The resource is the dynamic group
`cb-instance-dg`, matched by compartment and display name `cb-instance`.

```
Allow dynamic-group cb-instance-dg to read secret-bundles in compartment <compartment>
Allow dynamic-group cb-instance-dg to read objects in compartment <compartment> where target.bucket.name = 'cb-backups'
Allow dynamic-group cb-instance-dg to manage objects in compartment <compartment> where target.bucket.name = 'cb-backups'
```

The instance holds no OCI API key: it authenticates with its instance principal, which is
why the image can be rebuilt without carrying a credential (D20).

Nothing in this file grants Vault, Object Storage or IAM itself to `cb-ci`; the `cb-ci`
block stops at launch, volumes, VNIC and the network reads.
