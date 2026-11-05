# Security

Report problems with the benchmarks as an issue in [rathkit/rte](https://github.com/rathkit/rte/issues) with the label `benchmarks`. Issues, pull requests and discussions are turned off in this repository. Outside pull requests are not taken here.

Security problems are the exception: do not report them in an issue. Follow the organization's [security policy](https://github.com/rathkit/.github/blob/main/SECURITY.md).

## Scope

The benchmark runs the editor and a browser driver in a throwaway container with no network, so a problem in the recipe (the image, the flags, how a result is checked) belongs here and goes through the policy above. A problem in the browser driver or in the browser belongs upstream. A problem in the editor itself belongs to [rathkit/rte](https://github.com/rathkit/rte).
