# Leveraging DynamoDB's Auto-split: an Architecture suggestion

>_Disclaimer: I'm not affiliated with AWS and this is not technical advice. In case you consider using this pattern in production, please be aware this feature is very briefly documented and there is actually no performance guarantee._


According to the docs, DynamoDB's auto-split, _split-for-heat_ or _Adaptive Capacity auto-split_ is a (briefly documented) feature that "_rebalances your partitions such that frequently accessed items don't reside on the same partition_".

After performing [some tests](main blog post) to have a better understanding on how this feature actually works and to acknowledge that it isn't a replacement for [_write sharding_](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-sharding.html), I came up with this architecture as a way to improve read costs **for, maybe, some use cases**.

## Lazy Sharding

![Lazy Sharding](https://dev-to-uploads.s3.amazonaws.com/i/er6hlhjyccboiue43fz2.png)
<figcaption>Lazy Sharding</figcaption>

Basically, the idea here is to only write-shard the partition if our requests are being throttled. If they are, run a _de-sharding_ strategy to rewrite the items to a single partition, while DynamoDB takes care of the repartitioning. When reading, also perform an attemptive read on the main partition first, only performing a sharded read as a second attempt.

Here is a sample implementation, built using AWS CDK:






## Final Thoughts

Alternatively, for cases where the reads are disproportionally high, not allowing the partitioning to happen based on write velocities, similar de-sharding jobs can be ran, so attemptive reads on a single partition can be done in order to save RCUs.

