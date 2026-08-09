
{
  description = "ForgeGUI responsive hybrid HTML development environment";

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
          packages = [ pkgs.nodejs_22 ];

          shellHook = ''
            echo "Run: serve   (responsive dev site at http://localhost:8080)"
            echo "Run: build   (render the production site into dist/)"
            alias serve="node tools/site.mjs serve"
            alias build="node tools/site.mjs build"
          '';
        };

        apps.default = {
          type = "app";
          program = "${pkgs.writeShellScriptBin "serve" ''
            exec ${pkgs.nodejs_22}/bin/node "$PWD/tools/site.mjs" serve "$@"
          ''}/bin/serve";
        };
      });
}
