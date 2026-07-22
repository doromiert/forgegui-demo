
{
  description = "Quick static HTML dev server with file-watch/live-reload, serving cwd, index.html default";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [ pkgs.live-server ];

          shellHook = ''
            echo "Run: serve   (live-server, serves cwd, defaults to index.html, live-reloads on file change)"
            alias serve="live-server"
          '';
        };

        apps.default = {
          type = "app";
          program = "${pkgs.writeShellScriptBin "serve" ''
            exec ${pkgs.nodePackages.live-server}/bin/live-server --no-browser "$@"
          ''}/bin/serve";
        };
      });
}
