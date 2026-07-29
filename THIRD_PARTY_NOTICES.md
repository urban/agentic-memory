# Third-party notices

This project uses third-party software and model artifacts that remain subject to their own terms. This file does not license the Agentic Memory source code or replace any applicable third-party agreement.

## EmbeddingGemma

Agentic Memory can download and use the following embedding model for local semantic indexing and Recall:

- Model: EmbeddingGemma 300M
- Artifact: `embeddinggemma-300M-Q8_0.gguf`
- Source: [ggml-org/embeddinggemma-300M-GGUF](https://huggingface.co/ggml-org/embeddinggemma-300M-GGUF)
- Terms: [Gemma Terms of Use](https://ai.google.dev/gemma/terms)
- Incorporated restrictions: [Gemma Prohibited Use Policy](https://ai.google.dev/gemma/prohibited_use_policy)

Use of EmbeddingGemma is governed by the Gemma Terms of Use, including the incorporated prohibited-use restrictions. The public availability of the GGUF artifact does not replace or override those terms.

Agentic Memory currently downloads the model into a user-local cache and does not include the model artifact in this repository or its packages. Anyone who redistributes Gemma or a model derivative, including through a hosted service where covered by the terms, is responsible for complying with the then-current distribution requirements.

At the time this notice was written, distributions other than through a hosted service must include the following notice text required by the Gemma Terms of Use:

> Gemma is provided under and subject to the Gemma Terms of Use found at ai.google.dev/gemma/terms

The Gemma name and related trademarks belong to Google. Their use by Agentic Memory does not imply endorsement by or affiliation with Google.
