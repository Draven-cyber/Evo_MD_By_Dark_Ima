{ pkgs }: {
  deps = [
    pkgs.nodejs_18
    pkgs.nodePackages.npm
    pkgs.ffmpeg
    pkgs.imagemagick
    pkgs.git
    pkgs.yarn
    pkgs.python3
    pkgs.make
    pkgs.gcc
    pkgs.pkg-config
    pkgs.libwebp
    pkgs.cairo
    pkgs.pango
    pkgs.jpeg
    pkgs.giflib
    pkgs.librsvg
  ];
}
