#!/usr/bin/env bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
[ -f .nvmrc ] && nvm use --silent || nvm use 20 --silent

if [ -t 1 ]; then
  SUPPORTS_COLOR=true
else
  SUPPORTS_COLOR=false
fi

if [ -t 1 ]; then
  BOLD='\033[1m'
  CYAN='\033[0;36m'
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  BLUE='\033[0;34m'
  NC='\033[0m'
else
  BOLD=''
  CYAN=''
  RED=''
  GREEN=''
  YELLOW=''
  BLUE=''
  NC=''
fi
