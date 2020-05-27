# Maybe your DynamoDB write-sharding isn't worth the hassle

>Disclaimer: I'm not affiliated with AWS and this is not technical advice

A couple of months ago, revisiting DynamoDB's documentation, this piece caught my attention:
>### Isolate Frequently Accessed Items
>
>If your application drives disproportionately high traffic to one or more items, adaptive capacity rebalances your partitions such that frequently accessed items don't reside on the same partition\. This isolation of frequently accessed items reduces the likelihood of request throttling due to your workload exceeding the throughput limit on a single partition\. 
> 
>If your application drives consistently high traffic to a single item, adaptive capacity might rebalance your data such that a partition contains only that single, frequently accessed item\. In this case, DynamoDB can deliver throughput up to the partition maximum of 3,000 RCUs or 1,000 WCUs to that single item’s primary key\.
> 

Immediately after that, I remembered all the thousand times I watched Rick Houlihan's talks, specially the parts where he explains how to make use of __write-sharding__ in your DynamoDB table designs, in order to maximize throughput and avoid **hot partitions**.

It was clear to me that this piece of documentation talked about a feature that presumably addresses the same issue that __write-sharding__ addresses (hot partitions), but in an __adaptive__ way. Although the documentation doesn't tell us much, it does make a bold promise: **automatically repartition your items across many nodes as needed, down to a single-item partition**. It also felt to me like a very handy feature: hot partitions are a real thing at scale, and it's something you really need to consider before committing you table design. Also, not having to deal with __write-sharding__ means not having to pass it down the stack, forcing the application layer to handle it.

Naturally, an adaptive solution screams for a loosely coupled, fault tolerant application. Which is not necessarily the case for __write-sharding__, where the splitting happens on your side, under your control. But then again, what's the matter? The problem we're trying to address concerns applications running at high scale, which means that it's most likely built on top of these best practices, anyway. 

## Too good to be true

It got me intrigued. How come this feature exists and no one talks about it? So I started asking questions:

[alex-debrie-vs-me-screenshot]

[kirk-asking-tweet]

[asking-alex-and-forrest]

@NoSQLKnowHow's comments aside, which confirmed that the feature existed and there was an upcoming documentation overhaul that would make things clearer, no one else had an actual answer. I even tried to tease Rick Houlihan himself in a recent tweet, but no luck.

At this point, I was already paranoid. I needed to get rid of this doubt.

[funny gif spinning paranoia]


## The testing

So, I finally dedicated some good hours to build a test for this ghost.

Here is the bottom line: It works for reads, inserts and updates. If your system is fault-tolerant, loosely coupled, and you have to prevent hot partitions, you could leverage this feature to simplify your existent and future table designs.

Why fault-tolerant, you might ask. The answer is simple: your requests are going to throttle for a few minutes at the first time they get "hot". Your fault-tolerant system have to take care of those cases. After that, you're likely getting very small throttling rate. I had it around 0.002% for all batches that ranged from 1500 to 2000 WCU/s and 4000 to 6000 WCU/s of sustained throughput in a single partition!

As you can see below, I also tested preemptively warming-up the partition, in order to support the workload. And it works!

[throttling warm up]


## Final thoughts

It looks like DynamoDB, in fact, has a working auto-split feature for hot partitions (although it's poorly documented). By leveraging this feature, developers can solve the hot partition prevention problem by simply applying best practices for large scale / distributed systems, without needing to know partitions access velocities at design time.

