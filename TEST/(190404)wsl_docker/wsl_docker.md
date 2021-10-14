# WSL, Zsh, oh-my-zsh

[TOC]

---



## Windows10 

### Install Docker

- Visit Docker hompage



### Install Windows Subsystem Linux

- MS store
- NOT 18.04 LTS: Update ERRORs happen!!!!



### Install Powerline fonts for powerline theme for use in Oh-My-Zsh

- [How to install Powerline fonts in Windows](<https://medium.com/@slmeng/how-to-install-powerline-fonts-in-windows-b2eedecace58>)



## Ubuntu (WSL)



### Update

```
$ sudo apt-get update
```



### Check the version of Ubuntu

```
$ lsb_release -a
```

![](C:\Users\ChoiYB\Desktop\markdown_notes\wsl_docker\images\Screenshot_3.png)

### Install SpaceVim for Vim

- [Installation](<https://spacevim.org/quick-start-guide/#install>) for ONLY Vim (NOT Neovim)

  ```
  $ curl -sLf https://spacevim.org/install.sh | bash -s -- --install vim
  ```

- You will be face with **vimproc_Linux64.so is not found** error
  - How to solve the Error

  - ```
    $ sudo apt install build-essential
    ```

  - ```
    $ mkdir install_from_source
    $ cd install_from_source
    $ git clone http://github.com/Shougo/vimproc.vim
    ```

  - Go to the **vimproc.vim** folder

  - ```
    $ make
    ```

  - Check the folder **\install_from_source\vimproc.vim\lib**
    There must be **vimproc_linux64.so**

  - Copy the file to the **home\goodasa\\.cache\vimfiles\repos\github.com\Shougo\vimproc.vim\lib** folder

- Change Theme (gruvbox -> onedark)

  ```
  $ vim ~/.SpaceVim.d/init.toml
  ```

- [Uninstall](<https://github.com/SpaceVim/SpaceVim/issues/435>) SpaceVim and Install it ONLY for vim

  ```
  $ curl -sLf https://spacevim.org/install.sh | bash -s -- --uninstall
  $ rm -rf ~/.cache/{ctrlp/,neocomplete/,neomru/,neosnippet,neoyank,obexd,unite,vimfiles} ~/.SpaceVim ~/.SpaceVim.d ~/.vim
  ```



### [Install Neovim](<https://github.com/neovim/neovim/wiki/Installing-Neovim>)

```
$ sudo apt-get install neovim
```

- Install SpaceVim for Neovim

  ```
  $ curl -sLf https://spacevim.org/install.sh | bash -s -- --install neovim
  ```

- [Uninstall NeoVim](https://www.thelinuxfaq.com/ubuntu/ubuntu-17-04-zesty-zapus/neovim?type=uninstall)

  ```
  $ sudo apt-get remove --auto-remove neovim 
  ```

  

### Install zsh

```
$ sudo apt-get install zsh
```



### Install oh-my-zsh

#### 01 Install oh-my-zsh

```
$ sh -c "$(curl -fsSL https://raw.githubusercontent.com/robbyrussell/oh-my-zsh/master/tools/install.sh)"
```

- 설치가 완료되면 기본쉘을 자동으로 bash에서 zsh로 변경해준다
  ![](C:\Users\ChoiYB\Desktop\markdown_notes\wsl_docker\images\Screenshot_1.png)

- 터미널 기본 에디터로 vi대신 neovim을 사용하도록 ~/.zshrc에 다음 항목을 추가

  ```
  alias vim="nvim"
  alias vi="nvim"
  alias vimdiff="nvim -d"
  export EDITOR=/usr/local/bin/nvim
  ```

#### 02 To install [powerlevel9k theme](<https://github.com/bhilburn/powerlevel9k>) for use in Oh-My-Zsh

```
$ git clone https://github.com/bhilburn/powerlevel9k.git ~/.oh-my-zsh/custom/themes/powerlevel9k
```

**You then need to select this theme in your ~/.zshrc**

```
$ vi ~/.zshrc
```

- ZSH_THEME="powerlevel9k/powerlevel9k" 로 수정

**Check Themes**

```
$ cd ~/.oh-my-zsh/themes/
$ ls -a
```

**Check Plugins**

```
$ cd ~/.oh-my-zsh/plugins/
$ ls -a
```

#### 03 Configuring your terminal to use a Powerline-patched font

- Working & Rendering properly in the terminal(zsh)

![](C:\Users\ChoiYB\Desktop\markdown_notes\wsl_docker\images\Screenshot_2.png)



#### 04 Install Plug-ins

- Install **zsh-syntax-highlighting**

  - 명령어 하이라이팅 플러그인

  ```
  $ git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting
  ```

- Install **zsh-autosuggestions**

  - 자동완성 플러그인 

  ``` 
  $ git clone git://github.com/zsh-users/zsh-autosuggestions $ZSH_CUSTOM/plugins/zsh-autosuggestions
  ```

- [Install **fzf**](<https://github.com/junegunn/fzf#installation>)

  - 증분 검색을 통하여 원하는 파일이나 히스토리를 쉽고 빠르게 찾을 수 있게 해줍니다. 정확하게 원하는 값을 입력하지 않고 일부만 입력해도 실시간으로 검색 결과를 보여줍니다.
  - fzf is a general-purpose command-line fuzzy finder.

  ```
  $ git clone --depth 1 https://github.com/junegunn/fzf.git ~/.fzf
  $ ~/.fzf/install
  ```

- ~~Install [fasd](<https://github.com/clvv/fasd/wiki/Installing-via-Package-Managers>)~~

  - ~~사용빈도가 높은 파일 또는 디렉토리 검색을 편하게 해서 생산성을 향상시켜주는 도구입니다. 열어본 파일이나 이동한 디렉토리를 기억하고 우선순위를 정해서 빠르게 검색할 수 있게 도와줍니다.~~

  ```
  $ sudo add-apt-repository ppa:aacebedo/fasd
  $ sudo apt-get update
  $ sudo apt-get install fasd
  ```



#### 05 Add Plug-ins to ~/.zshrc

``` 
$ vim ~/.zshrc
```



```
plugins=(
  git
  zsh-syntax-highlighting
  zsh-autosuggestions
)
```



```
$ source ~/.zshrc
```

- 에러가 발행하면 아래의 커맨드 실행

  ```
  $ sudo apt-get update
  ```

  

---

### [asciinema](https://asciinema.org/)
터미널을 텍스트로 녹화하는 프로그램입니다. 영상으로 녹화하는 것보다 용량이 적고 품질도 훌륭한 편입니다. 제 블로그에서 자주 볼 수 있습니다.

### [neofetch](https://github.com/dylanaraps/neofetch)
지금 보고 있는 포스트 첫번째 이미지에서 사용한 프로그램입니다. 간단하게 시스템 상태를 보여줍니다.

### Screenfetch for Terminal

```
$ sudo apt-get install screenfetch
```

---

### Install Jupyter notebook on WSL

```
$ pip install jupyter
```

```
$ vim ~/.zshrc
```

```
$ alias jupyter-notebook="~/.local/bin/jupyter-notebook --no-browser"
```

```
$ source ~/.bashrc
```

```
$ jupyter-notebook
```





---

# Docker

### Docker for WSL

https://blog.jayway.com/2017/04/19/running-docker-on-bash-on-windows/

모두 설치후 아래 커맨드 실행: Docker 사용권한 주기

```
$ sudo usermod -aG docker $USER
```



### Exec Docker in WSL

https://subicura.com/2017/01/19/docker-guide-for-beginners-2.html



### Docker 명령어

- 실행중인 컨테이너 목록확인: $ docker ps

- $ docker ps -a

- 컨테이너 중지: $ docker stop 아이디

  ```
  $ docker ps # get container ID
  $ docker stop ${TENSORFLOW_CONTAINER_ID}
  $ docker ps -a # show all containers
  ```

- 컨테이너 삭제



### Docker 문제시 실행

[Error response from Demon](<https://forums.docker.com/t/error-response-from-daemon-get-https-registry-1-docker-io-v2/23741/9>)

-> 이렇게 하면 되지만 터미널에서 실행이 안됨

-> **그래서 윈도우즈 Docker를 재실행: Restart**



---

### 참고

### Install zsh-completions (이게 repo문제인것 같다)

```
$ wget -nv https://download.opensuse.org/repositories/shells:zsh-users:zsh-completions/xUbuntu_18.04/Release.key -O Release.key
$ sudo apt-key add - < Release.key
$ sudo apt-get update
$ sudo apt-get install zsh-completions
```

<https://software.opensuse.org/download.html?project=shells%3Azsh-users%3Azsh-completions&package=zsh-completions>

---

## References

01 https://www.howtoforge.com/tutorial/how-to-setup-zsh-and-oh-my-zsh-on-linux/

02 https://medium.com/@ssharizal/hyper-js-oh-my-zsh-as-ubuntu-on-windows-wsl-terminal-8bf577cdbd97

03 https://subicura.com/2017/11/22/mac-os-development-environment-setup.html