/**
 * The words of me7's public pages: one page for the whole wallet and one for each thing people
 * look for. Plain text only; site/render.ts turns it into HTML at build time. These pages carry
 * no scripts and never touch a key.
 *
 * Every claim here must be true of the wallet as it is. When the wallet changes, change the page.
 */
export type Lang = 'en' | 'ru';

export interface Section {
  h: string;
  /** Paragraphs. */
  p?: string[];
  /** A plain list. */
  list?: string[];
  /** Numbered steps. */
  steps?: string[];
}

export interface Content {
  /** The last part of the address; empty for the overview page. */
  slug: string;
  /** For the browser tab and search results (about 60 characters). */
  title: string;
  /** For search results and link previews (about 155 characters). */
  description: string;
  h1: string;
  lead: string;
  /** One line for the list of features on the overview page. */
  card: string;
  sections: Section[];
  faq: { q: string; a: string }[];
}

export interface Page {
  id: string;
  en: Content;
  ru: Content;
}

export const UI = {
  en: {
    open: 'Open the wallet',
    all: 'All features',
    more: 'More about me7',
    questions: 'Questions',
    source: 'Source code',
    other: 'Русский',
    foot: 'me7 is a program, and its code is public for anyone to check. Keep in it as much as you are prepared to trust to a program. The only official address is me7.network.',
    cta: 'No sign-up, no email, no app to install. The wallet opens in your browser.',
  },
  ru: {
    open: 'Открыть кошелёк',
    all: 'Все возможности',
    more: 'Ещё о me7',
    questions: 'Вопросы и ответы',
    source: 'Исходный код',
    other: 'English',
    foot: 'me7 — это программа, и её код открыт для проверки любым желающим. Держите в ней столько, сколько готовы доверить программе. Единственный официальный адрес — me7.network.',
    cta: 'Без регистрации, почты и установки приложений. Кошелёк открывается прямо в браузере.',
  },
} as const;

/** The overview: what me7 is, with a way into every other page. */
export const HUB: Page = {
  id: 'hub',
  en: {
    slug: '',
    title: 'me7 — self-custody crypto wallet in your browser',
    description:
      'A web wallet where the keys never leave your browser. Send USDC on Base without ETH, hide your key inside a photo, rotate addresses, cash out P2P. Source code is public.',
    h1: 'A crypto wallet where the keys stay with you',
    lead: 'me7 is a self-custody wallet that runs in your browser. No sign-up, no email, no identity check: you create a key, and only you hold it. It sends USDC without ETH for gas, hides your balance behind rotating addresses, and publishes its code so you do not have to take our word for anything.',
    card: '',
    sections: [
      {
        h: 'Why people pick me7',
        list: [
          'Nothing to install and nothing to register. Open the site, create a key, and the wallet is ready in a minute.',
          'You never need ETH to move USDC on Base. me7 pays the network gas; you pay one plain fee, about 1 USDC per operation, shown before you confirm.',
          'Your key is a file and a password, not twelve words on a slip of paper. The file can hide inside your own photo, PDF or song.',
          'A payer sees their own transfer, not your whole balance: the wallet hands out a new address after every payment received.',
          'Under pressure you can open a second, empty vault with a different password.',
          'The code is public, and one command checks that the site serves exactly that code.',
        ],
      },
      {
        h: 'Networks and coins',
        p: [
          'Base: USDC, ETH, cbBTC. Ethereum: ETH, USDT, USDC, DAI, LINK, WBTC, cbBTC. Tron: TRX and USDT. Bitcoin.',
          'USDC on Base is the main coin of the wallet: it is the one that moves without gas and with rotating addresses.',
        ],
      },
      {
        h: 'How your money is protected',
        list: [
          'Keys are created, kept and used in your browser. The server never receives them and cannot move your money.',
          'No third-party code sits near the keys: no analytics, no trackers, no remote scripts. The cryptography comes from audited open libraries pinned to exact versions.',
          'The site may only talk to a fixed list of addresses, enforced by the browser itself.',
          'Every release is signed with a key that is not on the server. If a single file on the server changes, the site takes itself off the air.',
          'With a Ledger the key stays on the device and every transfer is read on its screen.',
        ],
      },
      {
        h: 'What me7 is honest about',
        p: [
          'Nobody guarantees your safety: not a bank, not an exchange, not me7. A lost key cannot be restored and a sent transfer cannot be taken back. That is why we publish the code: so that you can check it yourself or ask someone you trust.',
        ],
      },
    ],
    faq: [
      { q: 'Is me7 free?', a: 'Creating a wallet, receiving and holding money cost nothing. Sending USDC on Base through me7 costs about 1 USDC per operation, which covers the network gas. Transfers in other networks cost only the network’s own fee.' },
      { q: 'Do I need to verify my identity?', a: 'No. There are no accounts on our side: no email, no phone number, no documents. Your account is your key.' },
      { q: 'What happens if me7 disappears?', a: 'Your money is in the blockchain under your key, not with us. The 24 recovery words open the same wallet in any other wallet that follows the common standards.' },
      { q: 'Can me7 freeze or take my money?', a: 'No. The server has no key to your wallet. It can refuse to pay gas for a transfer, for example to an address on a sanctions list, but it cannot move or hold what is yours.' },
      { q: 'Is there a mobile app?', a: 'The wallet is a website that works in a phone’s browser and can be added to the home screen. There is nothing to download from a store.' },
    ],
  },
  ru: {
    slug: '',
    title: 'me7 — некастодиальный криптокошелёк в браузере',
    description:
      'Веб-кошелёк, где ключи не покидают ваш браузер. USDC в сети Base без ETH, ключ внутри фотографии, ротация адресов, вывод через P2P. Исходный код открыт.',
    h1: 'Криптокошелёк, где ключи остаются у вас',
    lead: 'me7 — некастодиальный кошелёк, который работает прямо в браузере. Без регистрации, почты и проверки личности: вы создаёте ключ, и он есть только у вас. Кошелёк отправляет USDC без ETH на газ, прячет баланс за сменяемыми адресами и публикует свой код, чтобы вам не приходилось верить нам на слово.',
    card: '',
    sections: [
      {
        h: 'Почему выбирают me7',
        list: [
          'Ничего не нужно устанавливать и нигде регистрироваться. Открыли сайт, создали ключ, и через минуту кошелёк готов.',
          'Чтобы перевести USDC в сети Base, не нужен ETH. Газ сети оплачивает me7, а вы платите одну понятную комиссию, около 1 USDC за операцию, и видите её до подтверждения.',
          'Ключ — это файл и пароль, а не двенадцать слов на бумажке. Файл можно спрятать в своей фотографии, PDF или песне.',
          'Плательщик видит только свой перевод, а не весь ваш баланс: после каждого поступления кошелёк выдаёт новый адрес.',
          'Под давлением можно открыть второй, пустой сейф другим паролем.',
          'Код открыт, и одна команда проверяет, что сайт отдаёт именно его.',
        ],
      },
      {
        h: 'Сети и монеты',
        p: [
          'Base: USDC, ETH, cbBTC. Ethereum: ETH, USDT, USDC, DAI, LINK, WBTC, cbBTC. Tron: TRX и USDT. Bitcoin.',
          'USDC в сети Base — главная монета кошелька: именно она ходит без газа и со сменой адресов.',
        ],
      },
      {
        h: 'Как защищены ваши деньги',
        list: [
          'Ключи создаются, хранятся и используются в вашем браузере. Сервер их не получает и не может распоряжаться вашими деньгами.',
          'Рядом с ключами нет стороннего кода: ни аналитики, ни трекеров, ни внешних скриптов. Криптография — открытые библиотеки, прошедшие аудит, версии закреплены.',
          'Сайт может обращаться только к заранее заданному списку адресов, и за этим следит сам браузер.',
          'Каждый выпуск подписан ключом, которого нет на сервере. Если на сервере изменится хотя бы один файл, сайт сам снимет себя с эфира.',
          'С Ledger ключ остаётся в устройстве, а каждый перевод читается на его экране.',
        ],
      },
      {
        h: 'О чём me7 говорит честно',
        p: [
          'Никто не гарантирует вашу безопасность: ни банк, ни биржа, ни me7. Потерянный ключ нельзя восстановить, отправленный перевод нельзя вернуть. Поэтому мы публикуем код: чтобы вы могли проверить его сами или попросить того, кому доверяете.',
        ],
      },
    ],
    faq: [
      { q: 'me7 бесплатный?', a: 'Создать кошелёк, получать и хранить деньги можно бесплатно. Отправка USDC в сети Base через me7 стоит около 1 USDC за операцию, в эту сумму входит газ сети. Переводы в других сетях стоят только комиссию самой сети.' },
      { q: 'Нужно ли подтверждать личность?', a: 'Нет. У нас нет учётных записей: ни почты, ни телефона, ни документов. Ваш аккаунт — это ваш ключ.' },
      { q: 'Что будет, если me7 исчезнет?', a: 'Ваши деньги лежат в блокчейне под вашим ключом, а не у нас. 24 слова восстановления откроют тот же кошелёк в любом другом кошельке, который следует общим стандартам.' },
      { q: 'Может ли me7 заморозить или забрать мои деньги?', a: 'Нет. У сервера нет ключа от вашего кошелька. Он может отказаться оплачивать газ за перевод, например на адрес из санкционного списка, но распоряжаться вашими деньгами или удерживать их не может.' },
      { q: 'Есть ли мобильное приложение?', a: 'Кошелёк — это сайт. Он работает в браузере телефона, и его можно добавить на домашний экран. Скачивать из магазина приложений ничего не нужно.' },
    ],
  },
};

export const PAGES: Page[] = [
  {
    id: 'gasless',
    en: {
      slug: 'usdc-without-eth',
      title: 'Send USDC on Base without ETH for gas — me7',
      description: 'Got USDC on Base but no ETH to pay gas? me7 pays the network gas for you. One plain fee of about 1 USDC, shown before you confirm. No swap, no bridge, no sign-up.',
      h1: 'Send USDC on Base without ETH',
      lead: 'The usual story: USDC arrives on Base, you try to send it on, and the wallet says you need ETH for gas. In me7 you do not. You sign the transfer with your own key, and me7 pays the network gas.',
      card: 'Send USDC on Base with no ETH on the balance. me7 pays the gas.',
      sections: [
        {
          h: 'How it works',
          p: [
            'USDC on Base lets its owner sign a permission to move a fixed amount to a fixed address. Your browser signs that permission with your key; me7’s service carries it into the network and pays the gas in ETH out of its own pocket.',
            'The service cannot change the recipient or the amount: any change makes your signature invalid, and the token contract rejects it. It can only deliver what you signed, or not deliver it.',
          ],
        },
        {
          h: 'What it costs',
          list: [
            'About 1 USDC per operation: the network gas, rounded up to a cent, plus 1 USDC.',
            'One operation can pay up to five recipients for the same fee. Each recipient after the fifth adds 0.2 USDC.',
            'The exact fee is on the screen before you confirm, and it is taken in USDC from the same transfer. You never have to buy ETH.',
          ],
        },
        {
          h: 'How to do it',
          steps: [
            'Open me7.network and create a wallet, or sign in with your key file.',
            'Receive USDC on Base to the address the wallet shows.',
            'Press send, enter the address and the amount, and check the fee.',
            'Confirm with your password. The money arrives in seconds.',
          ],
        },
        {
          h: 'What to keep in mind',
          list: [
            'This works for USDC on the Base network. ETH and other tokens move the usual way, with the network’s own fee.',
            'Every address in an operation is checked against sanctions lists and a database of scam addresses. me7 does not pay gas for transfers to or from such addresses.',
            'If me7’s service is ever unavailable, the wallet has an emergency exit: USDC on your main address can be sent the ordinary way, with gas in ETH.',
          ],
        },
      ],
      faq: [
        { q: 'Why is there a fee if there is no gas?', a: 'There is gas, me7 just pays it instead of you. The fee covers that expense and the service itself. You see one number in USDC instead of juggling two coins.' },
        { q: 'Can me7 take more than the fee?', a: 'No. The fee is a separate permission for an exact amount that you sign yourself. Nothing can be taken beyond what you signed.' },
        { q: 'Does the recipient need me7?', a: 'No. They receive ordinary USDC on Base at an ordinary address, in any wallet or on an exchange.' },
      ],
    },
    ru: {
      slug: 'usdc-bez-eth',
      title: 'Отправить USDC в сети Base без ETH на газ — me7',
      description: 'Есть USDC в сети Base, но нет ETH на газ? В me7 газ сети оплачивает сервис. Одна понятная комиссия около 1 USDC, её видно до подтверждения. Без обмена и регистрации.',
      h1: 'Как отправить USDC в сети Base без ETH',
      lead: 'Знакомая история: USDC пришли в сеть Base, вы хотите отправить их дальше, а кошелёк требует ETH на газ. В me7 он не нужен. Вы подписываете перевод своим ключом, а газ сети оплачивает me7.',
      card: 'Перевод USDC в сети Base без ETH на балансе. Газ оплачивает me7.',
      sections: [
        {
          h: 'Как это работает',
          p: [
            'USDC в сети Base позволяет владельцу подписать разрешение на перевод точной суммы на точный адрес. Ваш браузер подписывает такое разрешение вашим ключом, а сервис me7 проводит его в сети и платит за газ своим ETH.',
            'Изменить получателя или сумму сервис не может: любое изменение делает вашу подпись недействительной, и контракт токена её отклонит. Сервис может только доставить подписанное вами или не доставить.',
          ],
        },
        {
          h: 'Сколько это стоит',
          list: [
            'Около 1 USDC за операцию: газ сети с округлением до цента плюс 1 USDC.',
            'Одной операцией можно заплатить до пяти получателям за ту же комиссию. Каждый получатель после пятого добавляет 0,2 USDC.',
            'Точная комиссия видна на экране до подтверждения и берётся в USDC из того же перевода. Покупать ETH не нужно вообще.',
          ],
        },
        {
          h: 'Как это сделать',
          steps: [
            'Откройте me7.network и создайте кошелёк или войдите по файлу-ключу.',
            'Получите USDC в сети Base на адрес, который покажет кошелёк.',
            'Нажмите «отправить», введите адрес и сумму, проверьте комиссию.',
            'Подтвердите паролем. Деньги дойдут за несколько секунд.',
          ],
        },
        {
          h: 'Что стоит знать',
          list: [
            'Так работает USDC в сети Base. ETH и другие токены отправляются обычным способом, с комиссией самой сети.',
            'Каждый адрес в операции сверяется с санкционными списками и базой мошеннических адресов. Газ за переводы на такие адреса и с них me7 не оплачивает.',
            'Если сервис me7 окажется недоступен, в кошельке есть аварийный выход: USDC с основного адреса можно отправить обычным способом, с газом в ETH.',
          ],
        },
      ],
      faq: [
        { q: 'Почему есть комиссия, если нет газа?', a: 'Газ есть, просто его платит me7 вместо вас. Комиссия покрывает этот расход и работу сервиса. Вы видите одну сумму в USDC и не держите вторую монету ради газа.' },
        { q: 'Может ли me7 взять больше комиссии?', a: 'Нет. Комиссия — это отдельное разрешение на точную сумму, которое вы подписываете сами. Взять больше подписанного невозможно.' },
        { q: 'Нужен ли получателю me7?', a: 'Нет. Он получает обычные USDC в сети Base на обычный адрес, в любой кошелёк или на биржу.' },
      ],
    },
  },
  {
    id: 'keyfile',
    en: {
      slug: 'key-file-wallet',
      title: 'A crypto wallet without a seed phrase on paper — me7',
      description: 'In me7 your account is a file and a password. The key can hide inside your own photo, PDF or song that still opens as usual. 24 recovery words stay as a spare.',
      h1: 'A wallet whose key hides inside a file',
      lead: 'Twelve words on a slip of paper are easy to lose and easy to find. In me7 the account is a key file locked with a password, and that file can be your own photo, a PDF or a song.',
      card: 'The account is a file and a password. The key hides inside your own photo.',
      sections: [
        {
          h: 'How the key file works',
          p: [
            'When you create a wallet, me7 makes a key file and locks it with your password. To sign in you need both: the file alone is useless, and so is the password alone.',
            'You can keep the key as a small separate file, or put it inside a file you already have. The photo still opens as a photo and the song still plays. Nothing about it says there is a wallet inside.',
          ],
        },
        {
          h: 'Why it is safer than a slip of paper',
          list: [
            'Someone who finds the file cannot open it without the password.',
            'A photo among thousands of photos attracts no attention; a sheet with twelve words does.',
            'A file is easy to copy to several places you trust: a flash drive, your own cloud, a second phone.',
            'To sign in, drop the file onto the page. Nothing is uploaded: the file is opened in your browser.',
          ],
        },
        {
          h: 'The 24 words are still there',
          p: [
            'With the key file you get 24 recovery words. They are the spare key: if the file is lost, the words open the wallet and issue a new file. They also work in other wallets that follow the common standard, so you are never tied to me7.',
            'Lose both the file and the words and the wallet is gone for good. We cannot help: we have no copy.',
          ],
        },
      ],
      faq: [
        { q: 'Does the photo change visibly?', a: 'No. The picture looks and opens the same. The key is added to the file in a way ordinary viewers ignore.' },
        { q: 'What if I send that photo through a messenger?', a: 'Many messengers and social networks re-compress pictures, which destroys the key inside. Keep the original file and send it as a document, not as a picture. And remember that without your password the key cannot be opened anyway.' },
        { q: 'Is my file or password sent to me7?', a: 'No. Both are used only inside your browser. The server never sees them.' },
      ],
    },
    ru: {
      slug: 'klyuch-v-fayle',
      title: 'Криптокошелёк без сид-фразы на бумажке — me7',
      description: 'В me7 аккаунт — это файл и пароль. Ключ можно спрятать в своей фотографии, PDF или песне: файл открывается как обычно. 24 слова остаются запасным ключом.',
      h1: 'Кошелёк, где ключ спрятан в файле',
      lead: 'Двенадцать слов на бумажке легко потерять и легко найти. В me7 аккаунт — это файл-ключ, закрытый паролем, и этим файлом может быть ваша фотография, PDF или песня.',
      card: 'Аккаунт — это файл и пароль. Ключ прячется в вашей же фотографии.',
      sections: [
        {
          h: 'Как устроен файл-ключ',
          p: [
            'При создании кошелька me7 делает файл-ключ и закрывает его вашим паролем. Для входа нужны оба: файл без пароля бесполезен, пароль без файла тоже.',
            'Ключ можно хранить отдельным маленьким файлом, а можно положить внутрь файла, который у вас уже есть. Фотография по-прежнему открывается как фотография, песня играет. Ничто не выдаёт, что внутри кошелёк.',
          ],
        },
        {
          h: 'Чем это надёжнее бумажки',
          list: [
            'Тот, кто нашёл файл, не откроет его без пароля.',
            'Фотография среди тысяч других не привлекает внимания, а листок с двенадцатью словами привлекает.',
            'Файл легко скопировать в несколько мест, которым вы доверяете: на флешку, в своё облако, на второй телефон.',
            'Чтобы войти, перетащите файл на страницу. Он никуда не загружается: файл открывается в вашем браузере.',
          ],
        },
        {
          h: '24 слова никуда не делись',
          p: [
            'Вместе с файлом-ключом вы получаете 24 слова восстановления. Это запасной ключ: если файл потерян, слова откроют кошелёк и выпустят новый файл. Они работают и в других кошельках, которые следуют общему стандарту, так что вы не привязаны к me7.',
            'Потеряете и файл, и слова — кошелёк потерян навсегда. Мы не поможем: копии у нас нет.',
          ],
        },
      ],
      faq: [
        { q: 'Фотография заметно меняется?', a: 'Нет. Картинка выглядит и открывается так же. Ключ добавляется в файл так, что обычные программы просмотра его не замечают.' },
        { q: 'А если отправить эту фотографию через мессенджер?', a: 'Многие мессенджеры и соцсети пережимают картинки, и ключ внутри при этом пропадает. Храните исходный файл и отправляйте его как документ, а не как картинку. И помните: без вашего пароля ключ всё равно не открыть.' },
        { q: 'Мой файл или пароль попадают на сервер me7?', a: 'Нет. Оба используются только внутри вашего браузера. Сервер их не видит.' },
      ],
    },
  },
  {
    id: 'open',
    en: {
      slug: 'open-source-wallet',
      title: 'A self-custody wallet with public source code — me7',
      description: 'me7 publishes the full source of its wallet and a one-command check that the live site serves exactly that code. Keys never leave your browser. No sign-up.',
      h1: 'A self-custody wallet you can check yourself',
      lead: 'A web wallet asks for a lot of trust: you open a site and type your key into it. me7 answers with the only thing that counts: the code is public, and anyone can check that the site runs exactly that code.',
      card: 'The code is public, and one command checks the site against it.',
      sections: [
        {
          h: 'What self-custody means here',
          p: [
            'Your keys are created, kept and used in your browser. They are never sent to us. We cannot see your balance by your name, restore your access, or move your money. If our server vanished tomorrow, your money would still be in the blockchain under your key.',
          ],
        },
        {
          h: 'What is published',
          list: [
            'Everything that runs in your browser: key generation, signing, transaction building, every screen.',
            'The tests, including ones that compare our signatures byte for byte with an independent library.',
            'A script that builds the site from the source and compares it with what me7.network sends to your browser.',
          ],
        },
        {
          h: 'How the site is kept honest',
          list: [
            'A strict Content-Security-Policy: the page may run only its own code and talk only to a fixed list of addresses.',
            'No third-party scripts, analytics or fonts. Nothing foreign is loaded next to your key.',
            'Dependencies are pinned to exact versions and cannot run code at install time.',
            'Every release is signed with a key that is kept off the server; the server refuses anything unsigned and takes the site down if a file changes.',
            'An outside watcher compares the live site with the signed release every half hour.',
          ],
        },
        {
          h: 'What public code means',
          p: [
            'Public code is not a promise that there are no mistakes. It means anyone can look for them, and anyone who finds one can prove it. The license lets you read, run and change the code for noncommercial use; the server side of our service is not published, and it never sees your keys.',
          ],
        },
      ],
      faq: [
        { q: 'Where is the code?', a: 'On GitHub: github.com/nomaddamone/me7-financial-infrastructure. The link is also in the header of the wallet.' },
        { q: 'How do I check the site?', a: 'Download the code, run npm ci and then sh verify.sh. It builds the site and compares every file with the one served at me7.network.' },
        { q: 'I am not a programmer. What does this give me?', a: 'Other people can check on your behalf, and anyone who finds a problem can prove it. A closed wallet asks you to believe; an open one can be caught lying.' },
      ],
    },
    ru: {
      slug: 'otkrytyy-kod',
      title: 'Некастодиальный кошелёк с открытым исходным кодом — me7',
      description: 'me7 публикует весь исходный код кошелька и проверку одной командой: сайт отдаёт именно этот код. Ключи не покидают браузер. Без регистрации.',
      h1: 'Некастодиальный кошелёк, который можно проверить самому',
      lead: 'Веб-кошелёк требует много доверия: вы открываете сайт и вводите в него ключ. me7 отвечает единственным, что тут имеет вес: код открыт, и любой может убедиться, что сайт исполняет именно его.',
      card: 'Код открыт, и одна команда сверяет с ним сайт.',
      sections: [
        {
          h: 'Что здесь значит «некастодиальный»',
          p: [
            'Ключи создаются, хранятся и используются в вашем браузере. Нам они не отправляются. Мы не можем посмотреть ваш баланс по имени, восстановить доступ или перевести ваши деньги. Если завтра наш сервер исчезнет, ваши деньги останутся в блокчейне под вашим ключом.',
          ],
        },
        {
          h: 'Что опубликовано',
          list: [
            'Всё, что исполняется в браузере: создание ключей, подпись, сборка переводов, каждый экран.',
            'Тесты, в том числе те, что сверяют наши подписи байт в байт с независимой библиотекой.',
            'Скрипт, который собирает сайт из исходников и сравнивает с тем, что me7.network присылает в ваш браузер.',
          ],
        },
        {
          h: 'Как сайт удерживается честным',
          list: [
            'Строгая Content-Security-Policy: страница может исполнять только свой код и обращаться только к заданному списку адресов.',
            'Никаких сторонних скриптов, аналитики и шрифтов. Рядом с вашим ключом не загружается ничего чужого.',
            'Версии зависимостей закреплены точно, и при установке они не могут исполнять код.',
            'Каждый выпуск подписан ключом, который хранится не на сервере; сервер не принимает ничего без подписи и снимает сайт, если файл изменился.',
            'Внешний наблюдатель каждые полчаса сверяет живой сайт с подписанным выпуском.',
          ],
        },
        {
          h: 'Что значит открытый код',
          p: [
            'Открытый код — это не обещание, что ошибок нет. Это значит, что искать их может любой, и тот, кто найдёт, сможет это доказать. Лицензия разрешает читать, запускать и менять код в некоммерческих целях; серверная часть нашего сервиса не опубликована, и ваших ключей она не видит.',
          ],
        },
      ],
      faq: [
        { q: 'Где лежит код?', a: 'На GitHub: github.com/nomaddamone/me7-financial-infrastructure. Ссылка есть и в шапке кошелька.' },
        { q: 'Как проверить сайт?', a: 'Скачайте код, выполните npm ci, затем sh verify.sh. Скрипт соберёт сайт и сравнит каждый файл с тем, что отдаёт me7.network.' },
        { q: 'Я не программист. Что мне это даёт?', a: 'За вас могут проверить другие, и любой, кто найдёт проблему, сможет её доказать. Закрытый кошелёк просит поверить, а открытый можно поймать на обмане.' },
      ],
    },
  },
  {
    id: 'cashout',
    en: {
      slug: 'cash-out-usdc',
      title: 'Cash out USDC without an exchange, person to person — me7',
      description: 'Sell USDC straight to a person for money in Revolut and other payment apps. The open Peer protocol runs the deal at the market rate. No exchange account needed.',
      h1: 'Cash out USDC without an exchange',
      lead: 'The usual road from USDC to ordinary money goes through an exchange: an account, an identity check, a deposit, a sale, a withdrawal. me7 has a shorter one built in: you sell USDC directly to another person.',
      card: 'Sell USDC straight to a person for money in a payment app.',
      sections: [
        {
          h: 'How it works',
          p: [
            'The deal is run by Peer, an open protocol on the Base network. You place USDC into the protocol’s contract. A buyer sends you money through a payment app such as Revolut and proves the payment to the contract. The contract then releases the USDC to the buyer.',
            'Nobody in the middle holds the money on their word: the USDC is held by a contract with public rules, and it is released only against proof of payment.',
          ],
        },
        {
          h: 'What you get',
          list: [
            'No exchange account and no deposit to an exchange.',
            'The rate is the market’s, and you see it before you start.',
            'The money arrives in a payment app you already use.',
            'Everything is done from the wallet’s P2P screen; your key stays in your browser.',
          ],
        },
        {
          h: 'What to keep in mind',
          list: [
            'Which payment apps and currencies are available is decided by the Peer protocol, not by me7. The wallet shows what is on offer at the moment.',
            'A deal needs a buyer, so it is not instant: an order can wait.',
            'Unsold USDC can be taken back from the contract.',
            'P2P works from the wallet’s main address. USDC from the other addresses is gathered onto it in one operation.',
          ],
        },
      ],
      faq: [
        { q: 'Is Peer part of me7?', a: 'No. Peer is an independent open protocol. me7 gives you a convenient way to use it from your own wallet.' },
        { q: 'Who do I trust in a deal?', a: 'The contract’s code and the proof of payment it checks, not the buyer’s promise. As with everything here: read the terms on the screen before you confirm.' },
      ],
    },
    ru: {
      slug: 'vyvod-usdc',
      title: 'Вывести USDC без биржи, напрямую человеку — me7',
      description: 'Продайте USDC напрямую человеку за деньги в Revolut и других платёжных приложениях. Сделку ведёт открытый протокол Peer по рыночному курсу. Аккаунт на бирже не нужен.',
      h1: 'Как вывести USDC без биржи',
      lead: 'Обычный путь из USDC в обычные деньги лежит через биржу: аккаунт, проверка личности, пополнение, продажа, вывод. В me7 встроен путь короче: вы продаёте USDC напрямую другому человеку.',
      card: 'Продажа USDC напрямую человеку за деньги в платёжном приложении.',
      sections: [
        {
          h: 'Как это работает',
          p: [
            'Сделку ведёт Peer, открытый протокол в сети Base. Вы кладёте USDC в контракт протокола. Покупатель отправляет вам деньги через платёжное приложение, например Revolut, и доказывает оплату контракту. После этого контракт отдаёт USDC покупателю.',
            'Никто посередине не держит деньги под честное слово: USDC лежат в контракте с открытыми правилами и выдаются только против доказательства оплаты.',
          ],
        },
        {
          h: 'Что вы получаете',
          list: [
            'Не нужен аккаунт на бирже и перевод на биржу.',
            'Курс рыночный, и вы видите его до начала сделки.',
            'Деньги приходят в платёжное приложение, которым вы уже пользуетесь.',
            'Всё делается с экрана P2P в кошельке; ключ остаётся в вашем браузере.',
          ],
        },
        {
          h: 'Что стоит знать',
          list: [
            'Какие платёжные приложения и валюты доступны, решает протокол Peer, а не me7. Кошелёк показывает то, что есть сейчас.',
            'Для сделки нужен покупатель, поэтому она не мгновенная: заявка может подождать.',
            'Непроданные USDC можно забрать из контракта обратно.',
            'P2P работает с основного адреса кошелька. USDC с остальных адресов собираются на него одной операцией.',
          ],
        },
      ],
      faq: [
        { q: 'Peer — это часть me7?', a: 'Нет. Peer — независимый открытый протокол. me7 даёт удобный способ пользоваться им из своего кошелька.' },
        { q: 'Кому я доверяю в сделке?', a: 'Коду контракта и доказательству оплаты, которое он проверяет, а не обещанию покупателя. Как и везде здесь: прочитайте условия на экране перед подтверждением.' },
      ],
    },
  },
  {
    id: 'privacy',
    en: {
      slug: 'private-usdc-payments',
      title: 'Receive USDC without showing your whole balance — me7',
      description: 'me7 gives you a new USDC address after every payment received, spends from as few addresses as it needs and pays through a one-time transit address. Privacy by default.',
      h1: 'Receive USDC without showing your balance',
      lead: 'On networks like Ethereum and Base a wallet usually has one address. Whoever paid you once can look that address up and see everything: your balance, your history, who else pays you. me7 works the way Bitcoin wallets do.',
      card: 'A new address after every payment: a payer sees their transfer, not your balance.',
      sections: [
        {
          h: 'Three things the wallet does for you',
          list: [
            'Address rotation. After every payment received, the wallet hands out a new address for USDC on Base. Old addresses keep working, and the balance in the wallet is one.',
            'Address selection. When you pay, the wallet spends from as few addresses as the amount needs and leaves the rest untouched and unseen.',
            'Transit address. The money is gathered on a fresh one-time address and leaves from there, all in a single operation.',
          ],
        },
        {
          h: 'What it looks like from outside',
          p: [
            'A client who paid you 200 USDC sees an address that received 200 USDC, and nothing else. Your next client gets another address. Someone you pay sees a one-time address that existed for one operation.',
            'You do nothing for this. There is one balance, one send button, and no addresses to manage.',
          ],
        },
        {
          h: 'What it is not',
          p: [
            'This is protection from curious eyes, not anonymity. Every transfer stays in the blockchain, and with enough effort your addresses can be linked. me7 does not mix funds and does not hide transfers; it simply stops showing your whole wallet to everyone who has ever paid you.',
          ],
        },
        {
          h: 'Why it is practical only here',
          p: [
            'Spending from many addresses normally means keeping ETH for gas on each one. In me7 the gas for USDC on Base is paid by the service, so addresses need no ETH at all, and gathering money from several of them costs the same single fee.',
          ],
        },
      ],
      faq: [
        { q: 'Do I have to back up every new address?', a: 'No. All addresses come from the same key. Your key file or 24 words restore all of them.' },
        { q: 'Can I still use one fixed address?', a: 'Yes. The main address of the wallet never changes and can be used for ETH, tokens and anything that needs a permanent address.' },
        { q: 'Will another wallet see money on these addresses?', a: 'They are standard addresses derived from your 24 words, so the money is recoverable, but a wallet that looks only at the first address will not show the rest by itself.' },
      ],
    },
    ru: {
      slug: 'privatnye-platezhi-usdc',
      title: 'Получать USDC и не показывать весь баланс — me7',
      description: 'me7 выдаёт новый адрес для USDC после каждого поступления, тратит с минимума адресов и платит через одноразовый транзитный адрес. Приватность по умолчанию.',
      h1: 'Как получать USDC и не показывать свой баланс',
      lead: 'В сетях вроде Ethereum и Base у кошелька обычно один адрес. Кто заплатил вам однажды, может открыть этот адрес и увидеть всё: баланс, историю, других плательщиков. me7 работает так, как устроены биткоин-кошельки.',
      card: 'Новый адрес после каждого платежа: плательщик видит свой перевод, а не ваш баланс.',
      sections: [
        {
          h: 'Три вещи, которые кошелёк делает за вас',
          list: [
            'Ротация адресов. После каждого поступления кошелёк выдаёт новый адрес для USDC в сети Base. Старые адреса продолжают работать, баланс в кошельке один.',
            'Выбор адресов. Когда вы платите, кошелёк тратит с такого числа адресов, какого требует сумма, а остальные остаются нетронутыми и невидимыми.',
            'Транзитный адрес. Деньги собираются на новом одноразовом адресе и уходят с него, всё одной операцией.',
          ],
        },
        {
          h: 'Как это выглядит снаружи',
          p: [
            'Клиент, который заплатил вам 200 USDC, видит адрес, на который пришло 200 USDC, и больше ничего. Следующий клиент получит другой адрес. Тот, кому платите вы, видит одноразовый адрес, который существовал ради одной операции.',
            'Вам для этого ничего делать не нужно. Один баланс, одна кнопка «отправить», никаких адресов вручную.',
          ],
        },
        {
          h: 'Чем это не является',
          p: [
            'Это защита от посторонних глаз, а не анонимность. Все переводы остаются в блокчейне, и при желании ваши адреса можно связать. me7 не смешивает средства и не скрывает переводы; он просто перестаёт показывать весь ваш кошелёк каждому, кто вам когда-либо платил.',
          ],
        },
        {
          h: 'Почему это удобно только здесь',
          p: [
            'Обычно, чтобы тратить со многих адресов, на каждом нужно держать ETH на газ. В me7 газ за USDC в сети Base оплачивает сервис, поэтому адресам ETH не нужен вовсе, а сбор денег с нескольких из них стоит ту же одну комиссию.',
          ],
        },
      ],
      faq: [
        { q: 'Нужно ли сохранять каждый новый адрес?', a: 'Нет. Все адреса выводятся из одного ключа. Файл-ключ или 24 слова восстанавливают их все.' },
        { q: 'Можно ли пользоваться одним постоянным адресом?', a: 'Да. Основной адрес кошелька не меняется, им можно пользоваться для ETH, токенов и всего, где нужен постоянный адрес.' },
        { q: 'Увидит ли другой кошелёк деньги на этих адресах?', a: 'Это стандартные адреса из ваших 24 слов, так что деньги восстановимы, но кошелёк, который смотрит только на первый адрес, остальные сам не покажет.' },
      ],
    },
  },
  {
    id: 'vault',
    en: {
      slug: 'hidden-vault',
      title: 'A hidden vault: a password that opens another wallet — me7',
      description: 'The me7 vault is a separate wallet made from a password by mathematics. A different password opens a different, empty vault. Nothing shows how many vaults exist.',
      h1: 'A hidden vault inside your wallet',
      lead: 'A password is usually right or wrong, and whoever gets past it gets everything. The vault in me7 works differently: every vault password opens a vault, and only you know which one holds the money.',
      card: 'A password that makes a wallet. Another password opens another, empty one.',
      sections: [
        {
          h: 'How the vault works',
          p: [
            'The vault password is not compared with a stored copy, the way websites do it. It is combined with your key by mathematics and turned into a separate wallet with its own addresses. Its recovery phrase exists nowhere: not on a server, not in a file, not on the screen.',
            'A different password gives a different wallet, a perfectly valid one that happens to be empty. There is no error message, because there is no wrong password.',
          ],
        },
        {
          h: 'Why it matters',
          list: [
            'If you are forced to open the wallet, you can open a vault with little or nothing in it.',
            'Nothing in the wallet or in the key file shows how many vaults you use or whether you use any.',
            'Someone who steals your key file and its password still does not get what is in the vault.',
          ],
        },
        {
          h: 'The price of it',
          p: [
            'The vault password cannot be reset or recovered by anyone, including you. Mistype it when you send money in, and the money lands in a vault you may never find again. When you create a vault the wallet asks for the password twice, and every open vault shows a short code by which you recognise it. Remember the code and check it every time.',
          ],
        },
      ],
      faq: [
        { q: 'Where is the vault stored?', a: 'Nowhere. It is recomputed from your key and the password every time you open it. There is nothing to find and nothing to delete.' },
        { q: 'Can I have several vaults?', a: 'Yes. Every password is its own vault.' },
        { q: 'Is the money in the vault visible in the blockchain?', a: 'The addresses are ordinary addresses, so the transfers are public like any others. What is hidden is that those addresses belong to you.' },
      ],
    },
    ru: {
      slug: 'skrytyy-seyf',
      title: 'Скрытый сейф: пароль, который открывает другой кошелёк — me7',
      description: 'Сейф в me7 — отдельный кошелёк, который математика создаёт из пароля. Другой пароль открывает другой, пустой сейф. Ничто не выдаёт, сколько сейфов у вас есть.',
      h1: 'Скрытый сейф внутри кошелька',
      lead: 'Обычно пароль либо верный, либо нет, и тот, кто его прошёл, получает всё. Сейф в me7 устроен иначе: любой пароль открывает кошелёк, и только вы знаете, в каком из них лежат деньги.',
      card: 'Пароль, который создаёт кошелёк. Другой пароль открывает другой, пустой.',
      sections: [
        {
          h: 'Как работает сейф',
          p: [
            'Пароль сейфа не сравнивается с сохранённой копией, как это делают сайты. Математика соединяет его с вашим ключом и превращает в отдельный кошелёк со своими адресами. Его фразы восстановления не существует нигде: ни на сервере, ни в файле, ни на экране.',
            'Другой пароль даёт другой кошелёк, совершенно настоящий, просто пустой. Сообщения об ошибке нет, потому что неверного пароля не бывает.',
          ],
        },
        {
          h: 'Зачем это нужно',
          list: [
            'Если вас вынуждают открыть кошелёк, можно открыть сейф, в котором мало или ничего нет.',
            'Ни в кошельке, ни в файле-ключе ничто не показывает, сколько у вас сейфов и есть ли они вообще.',
            'Тот, кто украл файл-ключ вместе с паролем от него, всё равно не получит то, что лежит в сейфе.',
          ],
        },
        {
          h: 'Цена вопроса',
          p: [
            'Пароль сейфа не может сбросить или восстановить никто, включая вас. Ошибётесь в нём при пополнении — деньги попадут в сейф, который вы можете больше не найти. При создании сейфа кошелёк просит ввести пароль дважды, а у каждого открытого сейфа показывает короткий код, по которому вы его узнаёте. Запомните код и сверяйте его каждый раз.',
          ],
        },
      ],
      faq: [
        { q: 'Где хранится сейф?', a: 'Нигде. Он вычисляется заново из вашего ключа и пароля каждый раз, когда вы его открываете. Нечего найти и нечего удалить.' },
        { q: 'Можно ли иметь несколько сейфов?', a: 'Да. Каждый пароль — это свой сейф.' },
        { q: 'Деньги в сейфе видны в блокчейне?', a: 'Адреса сейфа — обычные адреса, и переводы на них публичны, как любые другие. Скрыто то, что эти адреса принадлежат вам.' },
      ],
    },
  },
  {
    id: 'ledger',
    en: {
      slug: 'ledger-web-wallet',
      title: 'A web wallet for Ledger with no blind signing — me7',
      description: 'Connect a Ledger to me7 over USB or Bluetooth: Ethereum, Base and Tron. The key stays on the device, and every transfer is shown in full on its screen.',
      h1: 'Use a Ledger with no blind signing',
      lead: 'A hardware wallet protects the key, but it is often asked to confirm a string of characters without showing what it means. me7 never asks for that: what you sign is always readable on the device’s own screen.',
      card: 'The key stays in the Ledger. Every transfer is read on its screen.',
      sections: [
        {
          h: 'How it works',
          p: [
            'You connect the Ledger to the browser over USB or Bluetooth and open the Ethereum or Tron app on it. me7 reads your addresses, shows balances and prepares transfers. The private key never leaves the device, and me7 never has it.',
            'Before you confirm, the device shows the recipient, the amount and the coin. If the screen does not match what you intended, you refuse, and nothing is sent.',
          ],
        },
        {
          h: 'What is supported',
          list: [
            'Ethereum and Base: ETH and the tokens of the wallet, including USDC and USDT.',
            'Tron: TRX and USDT.',
            'Balance, receiving and sending. The wallet follows the app that is open on the device.',
            'Browsers built on Chromium, because they can talk to USB and Bluetooth devices.',
          ],
        },
        {
          h: 'Why no blind signing',
          p: [
            'Blind signing means approving data the device cannot display. A page that has been tampered with can then slip in another recipient, and the device will not warn you. me7 sends only transfers the Ledger can show in full, and does not ask you to switch that protection off.',
          ],
        },
      ],
      faq: [
        { q: 'Do I need Ledger’s own program running?', a: 'No. The browser talks to the device directly. Close other programs that hold the device, since only one can use it at a time.' },
        { q: 'Does me7 store anything about my Ledger?', a: 'Only a note in your browser that a device was paired, so that reconnecting is quicker. No keys.' },
        { q: 'Can I use Bitcoin with a Ledger in me7?', a: 'Not yet. Ledger mode covers Ethereum, Base and Tron.' },
      ],
    },
    ru: {
      slug: 'ledger-koshelek',
      title: 'Веб-кошелёк для Ledger без слепой подписи — me7',
      description: 'Подключите Ledger к me7 по USB или Bluetooth: Ethereum, Base и Tron. Ключ остаётся в устройстве, а каждый перевод полностью виден на его экране.',
      h1: 'Ledger без слепой подписи',
      lead: 'Аппаратный кошелёк защищает ключ, но его часто просят подтвердить набор символов, не показывая, что он значит. me7 так не делает никогда: то, что вы подписываете, всегда читается на экране самого устройства.',
      card: 'Ключ остаётся в Ledger. Каждый перевод читается на его экране.',
      sections: [
        {
          h: 'Как это работает',
          p: [
            'Вы подключаете Ledger к браузеру по USB или Bluetooth и открываете на нём приложение Ethereum или Tron. me7 читает адреса, показывает балансы и готовит переводы. Приватный ключ не покидает устройство, и у me7 его нет.',
            'Перед подтверждением устройство показывает получателя, сумму и монету. Если на экране не то, что вы задумали, вы отказываетесь, и ничего не уходит.',
          ],
        },
        {
          h: 'Что поддерживается',
          list: [
            'Ethereum и Base: ETH и токены кошелька, включая USDC и USDT.',
            'Tron: TRX и USDT.',
            'Баланс, получение и отправка. Кошелёк подстраивается под приложение, открытое на устройстве.',
            'Браузеры на основе Chromium: они умеют работать с устройствами по USB и Bluetooth.',
          ],
        },
        {
          h: 'Почему без слепой подписи',
          p: [
            'Слепая подпись — это согласие с данными, которые устройство не может показать. Подменённая страница тогда может подсунуть другого получателя, и устройство не предупредит. me7 отправляет только те переводы, которые Ledger показывает целиком, и не просит отключать эту защиту.',
          ],
        },
      ],
      faq: [
        { q: 'Нужна ли запущенная программа Ledger?', a: 'Нет. Браузер общается с устройством напрямую. Закройте другие программы, которые держат устройство: пользоваться им может только одна.' },
        { q: 'me7 хранит что-нибудь о моём Ledger?', a: 'Только отметку в вашем браузере о том, что устройство подключалось, чтобы быстрее соединяться снова. Никаких ключей.' },
        { q: 'Работает ли Bitcoin с Ledger в me7?', a: 'Пока нет. Режим Ledger охватывает Ethereum, Base и Tron.' },
      ],
    },
  },
  {
    id: 'batch',
    en: {
      slug: 'batch-usdc-payments',
      title: 'Pay many people in USDC with one operation — me7',
      description: 'Send USDC on Base to several recipients at once: everyone is paid or nobody is, for one fee. Saved contacts, no ETH for gas, no spreadsheets of addresses.',
      h1: 'Pay many people in USDC at once',
      lead: 'Paying a team, contractors or a group of friends usually means one transfer and one fee per person. In me7 it is one operation: you pick the recipients, sign once, and either everyone gets the money or nobody does.',
      card: 'Several recipients in one operation, for one fee: all are paid or none.',
      sections: [
        {
          h: 'How it works',
          steps: [
            'Save the people you pay as contacts: a name, an address, a coin.',
            'Open the batch payment and enter an amount next to each recipient. Rows without an amount are skipped.',
            'Check the total and the fee, and confirm with your password.',
            'One operation goes into the network and pays everyone at the same moment.',
          ],
        },
        {
          h: 'Why it is better than separate transfers',
          list: [
            'All or nothing. If any part cannot go through, nothing is sent, and you never end up with half the list paid.',
            'One fee. Up to five recipients cost the same as one; each one after the fifth adds 0.2 USDC.',
            'No ETH. The gas is paid by me7, as with any USDC transfer on Base in the wallet.',
            'Every address is checked against scam and sanctions lists before anything is sent.',
          ],
        },
        {
          h: 'Contacts that follow you',
          p: [
            'Contacts are encrypted in your browser with a key from your recovery phrase and only then stored on our server. We keep unreadable data and do not know whose it is. Sign in on another device and your list is there.',
          ],
        },
      ],
      faq: [
        { q: 'Which coins can be paid this way?', a: 'USDC on the Base network goes to everyone in one operation. Other coins can be sent to a list too, but as separate transfers one after another, each with the network’s own fee. Bitcoin is not included.' },
        { q: 'Do recipients see each other?', a: 'The transfers are in one transaction in a public blockchain, so anyone who looks at it sees all the addresses and amounts in it. Use separate payments where that matters.' },
        { q: 'Is there a limit on the number of recipients?', a: 'One operation carries a few dozen transfers.' },
      ],
    },
    ru: {
      slug: 'massovye-vyplaty-usdc',
      title: 'Заплатить многим в USDC одной операцией — me7',
      description: 'Отправьте USDC в сети Base нескольким получателям сразу: деньги получают либо все, либо никто, за одну комиссию. Контакты, без ETH на газ, без таблиц с адресами.',
      h1: 'Массовые выплаты в USDC одной операцией',
      lead: 'Заплатить команде, подрядчикам или компании друзей обычно значит по переводу и по комиссии на каждого. В me7 это одна операция: выбираете получателей, подписываете один раз, и деньги получают либо все, либо никто.',
      card: 'Несколько получателей одной операцией и одной комиссией: либо все, либо никто.',
      sections: [
        {
          h: 'Как это работает',
          steps: [
            'Сохраните тех, кому платите, в контакты: имя, адрес, монета.',
            'Откройте рассылку и впишите суммы напротив получателей. Строки без суммы пропускаются.',
            'Проверьте итог и комиссию, подтвердите паролем.',
            'В сеть уходит одна операция и платит всем в один момент.',
          ],
        },
        {
          h: 'Чем это лучше отдельных переводов',
          list: [
            'Всё или ничего. Если хоть одна часть не может пройти, не отправляется ничего, и вы не останетесь с наполовину оплаченным списком.',
            'Одна комиссия. До пяти получателей стоят как один; каждый после пятого добавляет 0,2 USDC.',
            'Без ETH. Газ оплачивает me7, как и за любой перевод USDC в сети Base в кошельке.',
            'Каждый адрес перед отправкой сверяется со списками мошеннических и санкционных.',
          ],
        },
        {
          h: 'Контакты, которые всегда с вами',
          p: [
            'Контакты шифруются в вашем браузере ключом из фразы восстановления и только потом сохраняются на нашем сервере. Мы храним нечитаемые данные и не знаем, чьи они. Войдите с другого устройства — список уже там.',
          ],
        },
      ],
      faq: [
        { q: 'Какие монеты можно так отправлять?', a: 'USDC в сети Base уходят всем одной операцией. Другие монеты тоже можно разослать по списку, но отдельными переводами один за другим, каждый со своей комиссией сети. Биткоин в рассылку не входит.' },
        { q: 'Видят ли получатели друг друга?', a: 'Переводы идут одной транзакцией в публичном блокчейне, поэтому тот, кто её откроет, увидит все адреса и суммы в ней. Где это важно, платите отдельно.' },
        { q: 'Есть ли предел числа получателей?', a: 'Одна операция вмещает несколько десятков переводов.' },
      ],
    },
  },
];
