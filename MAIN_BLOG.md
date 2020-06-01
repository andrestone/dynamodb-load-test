
>_Disclaimer: I'm not affiliated with AWS and this is not technical advice._

This is a _monopost_. If you're interested in a particular topic, you can read each digest as a separate post, by clicking in the correspondent link below.   


# Index
[1. Motivation](#motivation-top)

[2. CDK Load Testing App](#cdk-load-testing-apptop)

[3. Testing](#testing-top)

[4. DynamoDB Resilient Writing as an Alternative to _Write Sharding_](#speculations-top)

[5. Final Thoughts](#final-thoughts-top)


## Motivation <sub><sup>[[top]](#index)</sup></sub>

A couple of months ago, revisiting DynamoDB's documentation, this piece caught my attention:

![Very brief documentation](https://dev-to-uploads.s3.amazonaws.com/i/89msig8rwhhm1wentros.png)

Immediately after that, I remembered all the thousand times I watched [Rick Houlihan's talks](https://www.youtube.com/results?search_query=Rick+Houlihan), specially the parts where he explains how to make use of _write sharding_ on your DynamoDB table designs, in order to maximize throughput by avoiding **hot partitions**.

It was clear to me that this piece of documentation was about a feature that presumably addressed the same issue as _write sharding_ (hot partitions), but in an _adaptive_ way. Although the documentation doesn't tell us much, it does make a bold promise: **to automatically repartition your items across as many nodes as needed, down to a single-item partition**. It looked like a very handy feature, since hot partitions at scale are a real thing, and it's something you really need to consider before committing your table design. Also, not having to deal with _write sharding_ means not pushing it down the pipe, forcing the application layer to handle the bundled complexity. 

Most importantly, **_write sharding_ strategies linearly increase your throughput capacity consumption**. Since this "auto-split" feature comes at no cost, making use of it means saving money. 

Naturally, an adaptive solution at the service layer screams for a loosely coupled, fault tolerant system (which is not necessarily the case for _write sharding_, where the splitting happens on your side, under your control). But then again, what's the matter? The problem we're trying to address concerns applications running at high scale, and these are most likely built on top of those best practices, anyway. 

### Too good to be true? 

This whole thing got me intrigued. How come this feature exists and no one talks about it? So I started asking questions:

{% twitter 1250389357967654912 %}

{% twitter 1252703607931240449 %}

{% twitter 1258441534053257216 %}


[Kirk Kirkconnell](https://twitter.com/NoSQLKnowHow)'s answers aside, which confirmed that the feature existed and there was an upcoming documentation overhaul that would make things clearer, no one else had an actual answer. In a recent tweet, I even tried to tease [Rick Houlihan](https://twitter.com/houlihan_rick) himself, but had no luck there. 

_edit: A while later, Rick attentively answered all my questions and explained the reasons why he still doesn't advise the feature discussed here as a replacement for write sharding. Thanks, Rick!_

At this point, I was already getting paranoid.

![Paranoid](https://dev-to-uploads.s3.amazonaws.com/i/yzr8fxxewx3sv0vk4gt1.gif)

I needed to do something about it. 

## CDK Load Testing App <sub><sup>[[top]](#index)</sup></sub>

I finally dedicated some good hours to build a CDK stack to test this.
 [ some text ]
 Have a look at this blog post for more details.

## Tests <sub><sup>[[top]](#index)</sup></sub>

### Considerations

A few things to consider before load testing a DynamoDB table with On-Demand capacity mode on:
- There's a default limit of 40k WCUs and 40k RCUs.
- Tables running in On-Demand capacity mode have an initial "previous peak" value of 2k WCUs or 6k RCUs.
- The above means that the initial throughput limit for an On-Demand table is 4k WCUs or 12k RCUs (or a linear combination of the two, eg.: 0 WCUs and 12k RCUs).
- The new "previous peak" is established approximately 30 minutes after the new peak is reached, then effectively doubling the throughput limit.

It's also relevant to remember what exactly we are testing. We want to prove the hypothesis of performing read and write operations in a single table, using a single DynamoDB Partition Key, at a sustained throughput that has to be higher than the advertised limit (1k WCUs / 3k RCUs per partition).

### Smoke Testing

The first thing I wanted to test, was if this feature existed at all. In order to do this, I thought that if it was to exist, it would have to at least support reads.

In order to make read requests, I needed to populate the table. So, I triggered the execution of an insert batch, making sure the load didn't reach the throughput limit of the partition. By doing that, I also deployed all the resources configured.


Workers|Duration|Load|Interval|Target Throughput|Total Capacity
---|---|---|---|---|---
3 units|600 secs|300 items|1 sec|900 WCU|540k WCU

![Insert Batch Completed in Step Functions](https://dev-to-uploads.s3.amazonaws.com/i/txavzrvi1fz2anag5pda.png)
<figcaption>Insert Batch Completed in Step Functions</figcaption>


![DynamoDB Write Capacity Widget](https://dev-to-uploads.s3.amazonaws.com/i/1tgk5jsaitvuvp9ky3d9.png)
<figcaption>DynamoDB Write Capacity Widget</figcaption>


With the items in place, I ran another batch, this time with a target throughput of about 6k RCUs, which is twice the partition limit:

Workers|Duration|Load|Interval|Target Throughput|Total Capacity
---|---|---|---|---|---
20 units|600 secs|300 items|0.8 sec|6000 RCU|3600k RCU

![DynamoDB Read Capacity Widget](https://dev-to-uploads.s3.amazonaws.com/i/smufkymvgz4fw4l68x4m.png)
<figcaption>DynamoDB Read Capacity Widget</figcaption>


As you can see, we could reach the target throughput. This is our custom CloudWatch Dashboard Widget after performing both steps of this test:


![CloudWatch Dashboard](https://dev-to-uploads.s3.amazonaws.com/i/mjrsuw618k1a00g10rk8.png)
<figcaption>CloudWatch Dashboard Widget</figcaption>


However, we have experienced some throttling. DynamoDB Metrics says we had around 1.40% of throttled reads.

![DynamoDB Throttled Read Events Widget](https://dev-to-uploads.s3.amazonaws.com/i/bk1b5kx03yrz0qifmuki.png)
<figcaption>DynamoDB Throttled Read Events Widget</figcaption>


>_Since the node limit is 3k RCU, populating the table at around 900 WCU might have split our data into two nodes, allowing us to reach 6k RCUs._

Knowing how DynamoDB throughput limits work at the table level, I thought that maybe we have reached a new plateau at 6k RCUs. This would explain this marginal throttling rate.

### Smoking Test: Higher Load

Then, I ran another test. Starting again with a new table, populated within the partition limits. This time though, I'll try to reach something just below 10k RCUs. My goal here is to find another plateau and establish a pattern on the feature behaviour.

Workers|Duration|Load|Interval|Target Throughput|Total Capacity
---|---|---|---|---|---
33 units|600 secs|300 items|0.9 sec|9900 RCU|5940k RCU


![DynamoDB Widgets Reads and Throttles](https://dev-to-uploads.s3.amazonaws.com/i/2oh7yacn0a9q7r4h569f.png)
<figcaption>Throttled at 6k RCU, then reached the new peak.</figcaption>

As suspected, we indeed had reached a plateau at 6k RCU. It took around 8 minutes for the auto-split to kick in and repartition our data, so we could again reach another peak. Then we could run for the remaining 2 minutes without throttling.

![CloudWatch Dashboard](https://dev-to-uploads.s3.amazonaws.com/i/qvzm1py1q1mth0kjdrxu.png)
<figcaption>Surpassing the 6k plateau, peaking at around 9k RCU throttle-free.</figcaption>

Now let's see what happens when trying to read at 12k RCUs on the same table. The idea is to test for a new plateau and see if the feature can handle a sustained throughput at around the previous peak without throttling.

Workers|Duration|Load|Interval|Target Throughput|Total Capacity
---|---|---|---|---|---
42 units|600 secs|300 items|0.9 sec|12600 RCU|7200k RCU


Just like we have guessed, whatever the "auto-split" feature did, it's there. A relatively small throttle count happened when the throughput surpassed the 12k plateau, either because of the On-Demand initial table limit or because we have reached another plateau: 

![CloudWatch Dashboard](https://dev-to-uploads.s3.amazonaws.com/i/tdxs64yhir1wrauz3fe7.png)
<figcaption>No throttling at 6k RCU</figcaption>

### Testing the Plateau Pattern in a Real World Scenario

Now that we have a better hypothesis on how this feature works, let's try a real world scenario. Let's imagine that an application needs to support the case where a new Partition Key suddenly starts to suffer a big amount of reads and writes. Since it's a new partition, there's no chance it was already re-partitioned.

Our write workload will target 2.5k WCUs, and our read workload will target 6k RCUs

Workers|Duration|Load|Interval|Target Throughput|Total Capacity
---|---|---|---|---|---
5 units|600 secs|500 items|1 sec|2500 WCU|1500k WCU
20 units|600 secs| 300 items|0.9 sec|6000 RCU|3600k RCU


![Throttling fest!](https://dev-to-uploads.s3.amazonaws.com/i/h5w6yx0jxto7duc0hzqs.png)
<figcaption>Throttling fest!</figcaption>

As you can see, many bad things happened here. As we could have guessed, the re-partitioning isn't instantaneous, and it's unclear what exactly makes it happen.
 

![Throttled Events vs Consumed WCUs](https://dev-to-uploads.s3.amazonaws.com/i/w1pke21p785mh6tiizit.png)
<figcaption>Throttled Events vs Consumed WCUs</figcaption>

![Throttled Events vs Consumed RCUs](https://dev-to-uploads.s3.amazonaws.com/i/ranoc129hv6mkt8m5z6c.png)
<figcaption>Throttled Events vs Consumed RCUs</figcaption>

It's also interesting to see that the throughput capacity randomly reaches another plateau as if the feature didn't follow a time pattern.

### Another Test Case
Now let's imagine an application that needs its partitions to have their throughput capacity linearly increasing over time. Based on the tests performed so far, I'll run a test that simultaneously reads and writes to a new partition at an initial velocity of 100WCUs / 300RCUs and accelerates 15% every minute.

Workers|Duration|Load|Interval|Target Throughput|Total Capacity
---|---|---|---|---|---
5 units|1200 secs|20-277 items|1 sec|100-1385 WCU|600k WCU
20 units|1200 secs| 15 items|1 sec|300-4230 RCU|1830k RCU

![Still throttling...](dynamodb metrics throttling incremental)
<figcaption>Much better, but still some throttling.</figcaption>

If we look at all the tests so far, besides the fact that the split seems to be happening randomly across the test duration, we can see that the capacity is always increased by 1k WCUs each time a new plateau is reached. This behaviour makes me think that regardless of how much throttling is happening, the feature acts by adding a single node to the partition.  

Running another batch **on the same table**, now loading 6000 RCU + 2000 WCU steadily (which is actually 4 times the parition capacity, since the operations are running simultaneously), we can see that there's no throttling.

Workers|Duration|Load|Interval|Target Throughput|Total Capacity
---|---|---|---|---|---
5 units|600 secs|400 items|1 sec|2000 WCU|1200k WCU
20 units|600 secs| 300 items|1 sec|6000 RCU|3600k RCU

![No throttling](no throttling cw dashboard)
<figcaption>No throttling!</figcaption>

As you can see, the repartitioning is somewhat persistent.

### Settling down
In the next test, we'll apply the exact same load as the previous batch, which is again 4 times the initial partition capacity. But this time, we'll do it for 30 minutes in a new partition. The idea is to validate the behavior could infer from last test. We'll do it on the same table, so the table limits don't masquerade the results.

Workers|Duration|Load|Interval|Target Throughput|Total Capacity
---|---|---|---|---|---
5 units|1200 secs|400 items|1 sec|2000 WCU|1200k WCU
20 units|1200 secs| 300 items|1 sec|6000 RCU|3600k RCU

![Random plateau changes](30 min test random plateau changes over time)
<figcaption>Random plateau changes</figcaption>

Again, as you can see in the graph above, the time it takes for the partition to be split is pretty random, and it certainly depends on many variables we cannot control.

To make things even more clear, we'll do another batch on the same table and new partition, but now with a load of 5k WCUs for over an hour.

Workers|Duration|Load|Interval|Target Throughput|Total Capacity
---|---|---|---|---|---
10 units|4800 secs|400 items|1 sec|4000 WCU|19200k WCU

![Plateau changes](over one hour test escadinha plateau com throttles)
<figcaption>Random intervals, 1k WCUs per change.</figcaption>


### Test Conclusions
I think now we have a better idea of how the auto-split feature works and how we could make use of it. It looks like DynamoDB, in fact, has a working auto-split feature for hot partitions. It looks to me like it's a _best effort_ type of feature, since there are no guarantees on the splitting frequency and 

### Architecture Suggestion <sub><sup>[[top]](#index)</sup></sub>
(SDK throttles first)
 if throttle do (
    (shard and write) and 
    (send to SQS with lambda to 
        (retry and 
        set ttl to the sharded partition.
        )
    )
)


### Final Thoughts <sub><sup>[[top]](#index)</sup></sub>

The feature exists. It's there and in fact, it does the job it says it does. 



## Speculations <sub><sup>[[top]](#index)</sup></sub>

## Final Thoughts <sub><sup>[[top]](#index)</sup></sub>

It looks like DynamoDB, in fact, has a working auto-split feature for hot partitions (although it's poorly documented). By leveraging this feature, developers can solve the hot partition prevention problem by simply applying best practices for large scale / distributed systems, without needing to know partitions access velocities at design time.




Why fault-tolerant, you might ask. The answer is simple: your requests are going to throttle for a few minutes at the first time your partitions get "hot". Your fault-tolerant system have to take care of those throttled events. After that, it's auto-split heaven! I've had around 0.002% throttling rate for all batches. They ranged from 1500 to 2000 WCU/s and 4000 to 6000 RCU/s of sustained throughput in a single partition key!

As you can see below, I also tested preemptively warming-up the partition, in order to support the workload.

![Warming-up before the action](https://dev-to-uploads.s3.amazonaws.com/i/7r709fwkfdp2354fsnm2.png)
>### TL;DR
>Here is the bottom line: It works for reads, inserts and updates. If your system is fault-tolerant, loosely coupled, and you have to prevent hot partitions, you could leverage this feature to simplify your existent and future table designs.

--
André

