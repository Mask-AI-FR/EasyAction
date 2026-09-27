# EasyActions — portable Linux build

Works on any Linux distribution (Arch, Fedora, openSUSE, Debian, Ubuntu…). Nothing is installed
system-wide and root is never needed.

## Install

```sh
tar -xzf easyactions-*-linux-x64.tar.gz
cd easyactions-*-linux-x64
./install.sh
```

That symlinks `easyactions` into `~/.local/bin` and adds a menu entry. To undo it, run
`./install.sh --uninstall`; your data is left alone.

You can also skip `install.sh` entirely and run `./bin/easyactions` where it is.

## Get going

```sh
easyactions                                  # open the app in its own window
easyactions settings:setup-code              # code for the /setup page, valid 30 minutes
easyactions users:promote <your-github-login>  # make yourself an admin (sign in once first)
```

`easyactions help` lists everything else.

## Requirements

- `curl` — used to wait for the server to answer
- A Chromium browser (Brave, Chrome, Chromium, Edge, Vivaldi) for the app window. Without one, the
  address is printed and you can open it in any browser.

## Where things live

| | |
|---|---|
| Database | `~/.local/share/easyactions/pipliner.sqlite` |
| Settings | `~/.config/easyactions/env` |
| Server log | `~/.local/share/easyactions/server.log` |

Both directories are created `0700` and the database `0600`: yours only.
