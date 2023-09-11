# Google Docs Driver

This [Membrane](https://membrane.io) driver lets you interact with Google Docs through your Membrane graph.

To setup this driver follow steps:

 1. Add docs scopes in [Edit application record](https://console.cloud.google.com/apis/credentials/consent/edit)
 1. Enable Google Docs API on [Library](https://console.cloud.google.com/apis/library)
 1. Add callback URL to Authorized redirect URIs on [OAuth consent screen](https://console.cloud.google.com/apis/credentials/oauthclient/)
 1. Invoke the `:configure` Action with the Client ID and Client Secret.
 1. Open the Endpoint URL and follow steps.
