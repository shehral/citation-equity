# Retrieval-augmented generation, explained

Large language models are good at writing fluent text, but they only know what was in their training data, and they will happily make things up when they do not know the answer. Retrieval-augmented generation, usually shortened to RAG, is the most common way teams deal with both problems at once. Instead of asking the model to answer from memory, you first look up relevant documents and then hand those documents to the model along with the question. The model writes its answer from the material you gave it.

The sections below walk through how a RAG system is put together, where retrieval-augmented generation tends to go wrong, how it compares with fine-tuning, and how to tell whether it is working, so you can decide when it is the right tool for your own documents.

## What is retrieval-augmented generation?

Retrieval-augmented generation is a way of answering questions in which a system first searches a collection of documents for relevant passages and then asks a language model to write the answer from those passages. Think about how people answer hard questions. A good analyst does not answer a detailed question about a contract from memory; they pull up the contract, find the relevant clause, and then explain it. RAG asks a language model to work the same way.

The system takes the user's question, searches the documents for passages that look relevant, pastes the best passages into the prompt, and asks the model to answer using only those passages. The model is still doing the writing, but the facts come from the retrieved text rather than from whatever the model happened to absorb during training.

Keeping the documents outside the model has two practical benefits. You can update the documents whenever you like without retraining anything, and you can show the user which passages the answer came from, which makes it much easier to check the answer and to trust it when it is right.

## How does a RAG pipeline work?

A RAG pipeline prepares your documents ahead of time, then for each question retrieves the most relevant chunks and asks the model to answer from them. The details vary a lot from one system to the next, but most pipelines follow the same steps:
1. **Split the documents into chunks.** A whole manual is too long to fit in a prompt and too broad to match a specific question, so each document is cut into chunks, often somewhere between 200 and 500 tokens ([a chunking guide](https://example.com/guides/rag-chunking) compares common sizes).
2. **Embed each chunk.** Each chunk is turned into an embedding, a list of numbers that captures roughly what the chunk is about, and the embeddings go into a vector index so they can be searched quickly.
3. **Retrieve.** When a question comes in, the system embeds the question the same way, finds the chunks whose embeddings are closest, and usually keeps the top 5 or so.
4. **Add keyword search.** Many systems also run a keyword search such as BM25 alongside the vector search, because embeddings are good at meaning but surprisingly bad at exact terms like product codes, error numbers, and names.
5. **Rerank.** Some systems then rerank the combined results with a second model that reads each chunk next to the question and scores how well it answers it.
6. **Generate.** Finally the chosen chunks are placed into a prompt template with an instruction such as `Answer only from the sources below and cite them.`, and the model generates the answer.

Each of these steps is a place where quality can be won or lost. Chunk size, overlap between chunks, the embedding model, the number of chunks you keep, and the wording of the prompt all change the answers you get.

## Why does RAG still get things wrong?

Retrieval looks like a cure for hallucination, and it does help a lot, but it moves the problem rather than removing it. If the retriever brings back the wrong passages, the model will either answer from the wrong material or fall back on its own memory, and it will sound just as confident either way. If the right passage is retrieved but it is buried at position nine of ten, the model may ignore it. If two passages disagree, the model may blend them into an answer that neither one supports. And if the answer simply is not in your documents, many models will still produce something plausible rather than saying they do not know. In practice teams report that most bad RAG answers trace back to retrieval rather than to generation ([a write-up of RAG failure reviews](https://example.com/reports/rag-failure-review)), so it is worth measuring the two separately.

## RAG or fine-tuning?

People often ask whether they should use RAG or fine-tune a model on their data. The honest answer is that they solve different problems. Fine-tuning changes how a model behaves: its tone, its format, the kind of reasoning it does, or how it handles a narrow task it sees thousands of times. RAG changes what a model knows at the moment it answers.

Compared to fine-tuning, RAG is cheaper to update, since you only re-index documents, and it gives you citations, but it adds latency for the search step and it depends on the quality of your retrieval. The two also differ on cost: fine-tuning needs training data, often a few hundred to a few thousand examples, and compute up front, and it has to be redone when the facts change, while RAG mostly costs you an index and some extra tokens per query, about 1,500 more input tokens if you add five chunks of 300 tokens each.

A third option is to skip retrieval and paste whole documents into a long context window, which works for a handful of documents but gets slow and expensive as the collection grows. Many production systems end up combining a lightly fine-tuned model with retrieval.

| Approach     | What it changes                     | Updating facts                 | Citations | Main cost                              |
| ------------ | ----------------------------------- | ------------------------------ | --------- | -------------------------------------- |
| RAG          | What the model sees when it answers | Re-index the changed documents | Yes       | An index and extra tokens per query    |
| Fine-tuning  | How the model behaves               | Train again                    | No        | Training data and compute up front     |
| Long context | What the model sees, all at once    | Edit the pasted documents      | Possible  | Slow, costly prompts as documents grow |

## How do you know if it is working?

Evaluation is where a lot of RAG projects are weakest. You want to know two things: whether the retriever found the passages that contain the answer, and whether the model's answer is faithful to those passages ([an evaluation checklist](https://example.com/guides/rag-evaluation) covers both). The first can be measured with a small set of questions where you know which documents hold the answer, by checking how often those documents show up in the top results. The second is harder and usually involves either human review or a second model that checks each claim in the answer against the retrieved text. Track both over time, because a change that improves one can quietly hurt the other.

## Where should you start with RAG?

RAG is not magic, but it is the most practical way to ground a language model in your own documents today. A simple order of work keeps the project manageable:
- start with a simple pipeline
- measure retrieval and answers separately
- add complexity like reranking or hybrid search only when the numbers tell you that you need it
