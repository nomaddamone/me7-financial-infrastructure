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
    open: 'open the wallet',
    all: 'everything it does',
    more: 'More about me7',
    questions: 'Questions',
    source: 'Source code',
    other: 'Русский',
    foot: 'me7 is a program, and its code is public for anyone to check. Keep in it as much as you are prepared to trust to a program. The only official address is me7.network.',
    cta: 'No sign-up, no email, no app to install. The wallet opens in your browser.',
    soon: 'soon',
    groups: { protect: 'How it protects you', private: 'Who sees what', easy: 'What makes it easy' },
  },
  ru: {
    open: 'открыть кошелёк',
    all: 'всё, что он умеет',
    more: 'Ещё о me7',
    questions: 'Вопросы и ответы',
    source: 'Исходный код',
    other: 'English',
    foot: 'me7 — это программа, и её код открыт для проверки любым желающим. Держите в ней столько, сколько готовы доверить программе. Единственный официальный адрес — me7.network.',
    cta: 'Без регистрации, почты и установки приложений. Кошелёк открывается прямо в браузере.',
    soon: 'скоро',
    groups: { protect: 'Как он вас защищает', private: 'Кто что видит', easy: 'Чем он удобен' },
  },
} as const;

/** The overview: what me7 is, with a way into every other page. */
export const HUB: Page = {
  id: 'hub',
  en: {
    slug: '',
    title: 'What the me7 wallet does: protection, privacy, no gas to buy',
    description:
      'A web wallet where the keys never leave your browser. USDC on Base without ETH, USDT on Tron without TRX, a key hidden in a photo, rotating addresses. Source code is public.',
    h1: 'A crypto wallet where the keys stay with you',
    lead: 'me7 is a self-custody wallet that runs in your browser. No sign-up, no email, no identity check: you create a key, and only you hold it. It sends USDC without ETH and USDT without TRX, hides your balance behind rotating addresses, and publishes its code so you do not have to take our word for anything.',
    card: '',
    sections: [
      {
        h: 'Why people pick me7',
        list: [
          'Nothing to install and nothing to register. Open the site, create a key, and the wallet is ready in a minute.',
          'You never need ETH to move USDC on Base. me7 pays the network gas; you pay one plain fee, about 1 USDC per operation, shown before you confirm.',
          'The same goes for USDT on Tron: no TRX needed. me7 pays the network, and the fee is taken in USDT, shown before you confirm.',
          'USDT and USDC on Ethereum go without ETH as well: me7 lends the gas, and its fee is taken in the coin you send.',
          'A coin can be swapped for a coin on another network in one step, with no gas to buy on either side.',
          'Your key is a file and a password, not twelve words on a slip of paper. The file can hide inside your own photo, PDF or song.',
          'A payer sees their own transfer, not your whole balance: the wallet hands out a new address after every payment received.',
          'Stealth mode: one code that never changes, and every payer who uses it from me7 pays to a new address only you can find.',
          'USDT on Tron, and USDT or USDC on Ethereum, can be paid out of your USDC on Base, from a new address used once: the recipient does not see your own address.',
          'Money that reaches you from a sanctioned or frozen address quarantines only the address it came to, and any address can be checked with an AML report on request.',
          'Under pressure you can open a second, empty vault with a different password.',
          'A transfer is hard to send to the wrong place: an eight-digit address code to compare with the recipient, ten seconds to cancel after you confirm, and a receipt once it is sent. The wallet also warns about a look-alike of an address you know and about a USDT address that has been frozen.',
          'You can pay to a name such as anna.base.eth instead of forty characters, and take a name for your own address.',
          'The code is public, and one command checks that the site serves exactly that code.',
        ],
      },
      {
        h: 'Networks and coins',
        p: [
          'Base: USDC, ETH, cbBTC. Ethereum: ETH, USDT, USDC, DAI, LINK, WBTC, cbBTC. Tron: TRX and USDT. Bitcoin.',
          'USDC on Base is the main coin of the wallet: it moves without ETH and with rotating addresses. USDT on Tron moves without TRX, and USDT and USDC on Ethereum without ETH.',
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
      { q: 'Is me7 free?', a: 'Creating a wallet, receiving and holding money cost nothing. Sending USDC on Base through me7 costs about 1 USDC per operation, which covers the network gas. Sending USDT on Tron from an address with no TRX costs about 3 USDT, which covers the network too. Other transfers cost only the network’s own fee.' },
      { q: 'Do I need to verify my identity?', a: 'No. There are no accounts on our side: no email, no phone number, no documents. Your account is your key.' },
      { q: 'What happens if me7 disappears?', a: 'Your money is in the blockchain under your key, not with us. The 24 recovery words open the same wallet in any other wallet that follows the common standards.' },
      { q: 'Can me7 freeze or take my money?', a: 'No. The server has no key to your wallet. It can refuse to pay gas for a transfer, for example to an address on a sanctions list, but it cannot move or hold what is yours.' },
      { q: 'Is there a mobile app?', a: 'The wallet is a website that works in a phone’s browser and can be added to the home screen. There is nothing to download from a store.' },
    ],
  },
  ru: {
    slug: '',
    title: 'Что умеет кошелёк me7: защита, приватность, переводы без газа',
    description:
      'Веб-кошелёк, где ключи не покидают ваш браузер. USDC в сети Base без ETH, USDT в сети Tron без TRX, ключ внутри фотографии, ротация адресов. Исходный код открыт.',
    h1: 'Криптокошелёк, где ключи остаются у вас',
    lead: 'me7 — некастодиальный кошелёк, который работает прямо в браузере. Без регистрации, почты и проверки личности: вы создаёте ключ, и он есть только у вас. Кошелёк отправляет USDC без ETH и USDT без TRX, прячет баланс за сменяемыми адресами и публикует свой код, чтобы вам не приходилось верить нам на слово.',
    card: '',
    sections: [
      {
        h: 'Почему выбирают me7',
        list: [
          'Ничего не нужно устанавливать и нигде регистрироваться. Открыли сайт, создали ключ, и через минуту кошелёк готов.',
          'Чтобы перевести USDC в сети Base, не нужен ETH. Газ сети оплачивает me7, а вы платите одну понятную комиссию, около 1 USDC за операцию, и видите её до подтверждения.',
          'То же с USDT в сети Tron: TRX не нужны. Сеть оплачивает me7, а комиссия берётся в USDT, и её видно до подтверждения.',
          'USDT и USDC в сети Ethereum тоже уходят без ETH: газ даёт me7, а комиссия берётся в той монете, которую вы отправляете.',
          'Монету можно обменять на монету в другой сети за один шаг, не покупая газ ни с одной стороны.',
          'Ключ — это файл и пароль, а не двенадцать слов на бумажке. Файл можно спрятать в своей фотографии, PDF или песне.',
          'Плательщик видит только свой перевод, а не весь ваш баланс: после каждого поступления кошелёк выдаёт новый адрес.',
          'Stealth mode: один постоянный код, и каждый, кто платит по нему из me7, платит на новый адрес, который можете найти только вы.',
          'USDT в сети Tron, USDT и USDC в сети Ethereum можно заплатить из своих USDC в Base, с нового адреса, которым кошелёк пользуется один раз: ваш собственный адрес получатель не увидит.',
          'Деньги, пришедшие с санкционного или замороженного адреса, ставят на карантин только тот адрес, куда они пришли, а любой адрес можно проверить отчётом AML по запросу.',
          'Под давлением можно открыть второй, пустой сейф другим паролем.',
          'Перевод трудно отправить не туда: восьмизначный код адреса для сверки с получателем, десять секунд на отмену после подтверждения и отчёт после отправки. Кошелёк также предупредит о подделке под знакомый адрес и о замороженном адресе USDT.',
          'Платить можно на имя вроде anna.base.eth вместо сорока символов, а для своего адреса взять собственное имя.',
          'Код открыт, и одна команда проверяет, что сайт отдаёт именно его.',
        ],
      },
      {
        h: 'Сети и монеты',
        p: [
          'Base: USDC, ETH, cbBTC. Ethereum: ETH, USDT, USDC, DAI, LINK, WBTC, cbBTC. Tron: TRX и USDT. Bitcoin.',
          'USDC в сети Base — главная монета кошелька: она ходит без ETH и со сменой адресов. USDT в сети Tron ходит без TRX, а USDT и USDC в сети Ethereum без ETH.',
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
      { q: 'me7 бесплатный?', a: 'Создать кошелёк, получать и хранить деньги можно бесплатно. Отправка USDC в сети Base через me7 стоит около 1 USDC за операцию, в эту сумму входит газ сети. Отправка USDT в сети Tron с адреса без TRX стоит около 3 USDT, сеть тоже входит в эту сумму. Остальные переводы стоят только комиссию самой сети.' },
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
            'This works for USDC on the Base network. USDT on Tron moves without TRX in a similar way. ETH and other tokens move the usual way, with the network’s own fee.',
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
            'Так работает USDC в сети Base. USDT в сети Tron похожим образом ходит без TRX. ETH и другие токены отправляются обычным способом, с комиссией самой сети.',
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
    id: 'tronless',
    en: {
      slug: 'usdt-without-trx',
      title: 'Send USDT (TRC-20) on Tron without TRX — me7',
      description: 'USDT on Tron but no TRX for the fee? me7 pays the network for you and takes one fee in USDT, shown before you confirm. No TRX to buy, no energy to rent, no sign-up.',
      h1: 'Send USDT on Tron without TRX',
      lead: 'USDT arrives on your Tron address, you try to send it on, and the wallet asks for TRX you do not have. In me7 you do not need it. You sign the transfer with your own key; me7 pays the network, and the fee comes out of the same USDT.',
      card: 'Send USDT (TRC-20) with no TRX on the address. The fee is taken in USDT.',
      sections: [
        {
          h: 'How it works',
          p: [
            'A USDT transfer on Tron spends energy, and an address with no energy and no TRX cannot move at all. me7’s service rents the energy onto your address for the minutes the transfer needs, adds the little TRX the network wants for the bytes, and only then sends your transfer.',
            'Your browser signs two transfers with your key: the payment to your recipient and the fee to me7. The service cannot change the recipient or either amount: a changed transfer no longer matches your signature and the network rejects it. It can only deliver what you signed, or not deliver it.',
          ],
        },
        {
          h: 'What it costs',
          list: [
            'me7’s own expense on energy and TRX, plus 1.5 USDT per transfer. Usually that comes to about 3 USDT.',
            'The exact fee is on the screen before you confirm. It is taken in USDT on top of the amount, so the recipient gets exactly what you entered.',
            'It is close to what the network itself would burn in TRX for the same transfer, only you never have to buy TRX or keep it in reserve.',
            'If your address does hold enough TRX, the wallet pays the network the ordinary way and me7 takes nothing.',
          ],
        },
        {
          h: 'How to do it',
          steps: [
            'Open me7.network and create a wallet, or sign in with your key file.',
            'Receive USDT on Tron (TRC-20) to the address the wallet shows.',
            'Press send, choose USDT on Tron, enter the address and the amount.',
            'Check the fee and confirm with your password. The transfer takes up to a minute.',
          ],
        },
        {
          h: 'What to keep in mind',
          list: [
            'This works for USDT on the Tron network. It also works from a brand-new address that has never been activated.',
            'Addresses are checked against a sanctions list. me7 does not carry transfers to or from such addresses.',
            'After you confirm there are ten seconds to cancel. Once the transfer is in the network it cannot be taken back.',
            'With a Ledger, USDT on Tron is sent the ordinary way, with the fee in TRX.',
          ],
        },
      ],
      faq: [
        { q: 'Do I need any TRX at all?', a: 'No. An address with USDT and zero TRX is enough. me7 rents the energy and adds the TRX the network asks for.' },
        { q: 'Can me7 take more than the fee shown?', a: 'No. The fee is a separate transfer for an exact amount that you sign yourself. Nothing moves beyond the two transfers you signed.' },
        { q: 'Why is the fee higher when the recipient has never held USDT?', a: 'The network itself charges about twice the energy for the first USDT an address receives. The wallet shows the fee for your exact transfer before you confirm.' },
        { q: 'Does the recipient need me7?', a: 'No. They receive ordinary USDT (TRC-20) at an ordinary Tron address, in any wallet or on an exchange.' },
      ],
    },
    ru: {
      slug: 'usdt-bez-trx',
      title: 'Отправить USDT (TRC-20) в сети Tron без TRX — me7',
      description: 'Есть USDT в сети Tron, но нет TRX на комиссию? В me7 сеть оплачивает сервис, а одна комиссия берётся в USDT и видна до подтверждения. Без покупки TRX и регистрации.',
      h1: 'Как отправить USDT в сети Tron без TRX',
      lead: 'USDT пришли на ваш адрес в сети Tron, вы хотите отправить их дальше, а кошелёк требует TRX, которых нет. В me7 они не нужны. Вы подписываете перевод своим ключом, сеть оплачивает me7, а комиссия берётся из тех же USDT.',
      card: 'Перевод USDT (TRC-20) без TRX на адресе. Комиссия берётся в USDT.',
      sections: [
        {
          h: 'Как это работает',
          p: [
            'Перевод USDT в сети Tron расходует энергию, и адрес без энергии и без TRX не может отправить ничего. Сервис me7 арендует энергию на ваш адрес на те минуты, что нужны для перевода, добавляет немного TRX, которые сеть берёт за байты, и только после этого отправляет ваш перевод.',
            'Ваш браузер подписывает вашим ключом два перевода: платёж получателю и комиссию me7. Изменить получателя или любую из сумм сервис не может: изменённый перевод перестаёт соответствовать подписи, и сеть его отклонит. Сервис может только доставить подписанное вами или не доставить.',
          ],
        },
        {
          h: 'Сколько это стоит',
          list: [
            'Расход me7 на энергию и TRX плюс 1,5 USDT за перевод. Обычно выходит около 3 USDT.',
            'Точная комиссия видна на экране до подтверждения. Она списывается в USDT сверх суммы, поэтому получателю приходит ровно столько, сколько вы ввели.',
            'Это близко к тому, что сеть сама сожгла бы в TRX за такой же перевод, только покупать TRX и держать их про запас вам не нужно.',
            'Если TRX на адресе хватает, кошелёк платит сети обычным способом, и me7 ничего не берёт.',
          ],
        },
        {
          h: 'Как это сделать',
          steps: [
            'Откройте me7.network и создайте кошелёк или войдите по файлу-ключу.',
            'Получите USDT в сети Tron (TRC-20) на адрес, который покажет кошелёк.',
            'Нажмите «отправить», выберите USDT в сети Tron, введите адрес и сумму.',
            'Проверьте комиссию и подтвердите паролем. Перевод занимает до минуты.',
          ],
        },
        {
          h: 'Что стоит знать',
          list: [
            'Так работает USDT в сети Tron. Работает и с совсем нового адреса, который ещё не активирован.',
            'Адреса сверяются с санкционным списком. Переводы на такие адреса и с них me7 не проводит.',
            'После подтверждения есть десять секунд на отмену. Когда перевод ушёл в сеть, вернуть его нельзя.',
            'С Ledger USDT в сети Tron отправляется обычным способом, с комиссией в TRX.',
          ],
        },
      ],
      faq: [
        { q: 'Нужны ли мне вообще TRX?', a: 'Нет. Достаточно адреса, на котором есть USDT и ноль TRX. me7 арендует энергию и добавляет TRX, которые просит сеть.' },
        { q: 'Может ли me7 взять больше показанной комиссии?', a: 'Нет. Комиссия — это отдельный перевод на точную сумму, который вы подписываете сами. Кроме двух подписанных вами переводов ничего не уйдёт.' },
        { q: 'Почему комиссия выше, если получатель ещё не держал USDT?', a: 'Сама сеть берёт примерно вдвое больше энергии за первые USDT, которые приходят на адрес. Кошелёк показывает комиссию именно для вашего перевода до подтверждения.' },
        { q: 'Нужен ли получателю me7?', a: 'Нет. Он получает обычные USDT (TRC-20) на обычный адрес сети Tron, в любой кошелёк или на биржу.' },
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
            'P2P works from the wallet’s main address. USDC from the other addresses is gathered onto it, and ETH for the contract’s gas is put there by me7’s service, in one operation paid for in USDC: you need no ETH.',
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
            'P2P работает с основного адреса кошелька. USDC с остальных адресов собирает на него сервис me7 и он же кладёт туда ETH на газ контракта, одной операцией с комиссией в USDC: свой ETH не нужен.',
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
        { q: 'What if I need one thing to give to many payers?', a: 'Use stealth mode. It gives you one code that never changes, and every payer who uses it from me7 pays to a new address only you can find. It works from me7 to me7; for other wallets and exchanges keep the rotating address.' },
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
        { q: 'А если нужен один реквизит сразу для многих плательщиков?', a: 'Включите stealth mode. Он даёт один постоянный код, и каждый, кто платит по нему из me7, платит на новый адрес, который можете найти только вы. Работает из me7 в me7; другим кошелькам и биржам по-прежнему давайте сменяемый адрес.' },
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
            'USDT and USDC on Ethereum with no ETH, and USDT on Tron with no TRX: me7’s service pays the network, and the device shows two plain transfers, its fee and your payment.',
            'A swap for a coin on another network: a plain transfer to the crossing service’s address, which the wallet shows beside for you to compare with the device.',
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
            'USDT и USDC в Ethereum без ETH и USDT в Tron без TRX: сеть оплачивает сервис me7, а устройство показывает два обычных перевода, его комиссию и ваш платёж.',
            'Обмен на монету в другой сети: обычный перевод на адрес сервиса перехода, который кошелёк показывает рядом, чтобы сверить с экраном устройства.',
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
  {
    id: 'names',
    en: {
      slug: 'wallet-name',
      title: 'A name instead of a wallet address: send by name — me7',
      description: 'In me7 you can pay to a name like anna.base.eth instead of forty characters, and get such a name for your own address. Paid in USDC, no ETH needed.',
      h1: 'A name instead of forty characters',
      lead: 'A wallet address is forty characters nobody can remember or read aloud. In me7 you can send to a name such as anna.base.eth, and take a name for your own address without leaving the wallet.',
      card: 'Pay to anna.base.eth instead of an address, and get a name of your own.',
      sections: [
        {
          h: 'Sending to a name',
          p: [
            'Type a name ending in .base.eth or .eth into the recipient field. The wallet looks it up in the public registry in the blockchain and shows the address it points to, with that address’s code, before you confirm.',
            'The name is only a way to find the address. The transfer itself goes to the address you saw on the screen.',
          ],
        },
        {
          h: 'A name of your own',
          list: [
            'On the receive screen you can pick a free name and register it in the Base network’s registry for a year. It points to your main address.',
            'You pay in USDC: the registry’s price and the gas, plus 0.5 USDC. No ETH is needed. Longer names cost the registry a few cents a year; short ones cost more.',
            'A name is three characters or more: small Latin letters, digits and a hyphen inside.',
            'The name then shows at the top of your wallet, and one tap copies it.',
          ],
        },
        {
          h: 'What to keep in mind',
          list: [
            'A name is public. Anyone who knows it sees the address behind it and that address’s history, so give it to those you would give the address to.',
            'The name leads to the main address of the wallet. Rotating addresses for USDC keep working beside it.',
            'The name lives in the registry of the Base network, not with me7: it stays yours with your key, and other wallets that read this registry understand it too.',
          ],
        },
      ],
      faq: [
        { q: 'Which names can I send to?', a: 'Names ending in .base.eth and .eth. If a name is not registered or has no address attached, the wallet says so and sends nothing.' },
        { q: 'Does the payer need me7 to pay to my name?', a: 'No. Any wallet that understands such names will find your address by it.' },
        { q: 'What happens after a year?', a: 'The registration runs for a year and can be extended in the registry of the Base network.' },
      ],
    },
    ru: {
      slug: 'imya-koshelka',
      title: 'Имя вместо адреса кошелька: перевод по имени — me7',
      description: 'В me7 можно платить на имя вроде anna.base.eth вместо сорока символов и получить такое имя для своего адреса. Оплата в USDC, ETH не нужен.',
      h1: 'Имя вместо сорока символов',
      lead: 'Адрес кошелька — это сорок символов, которые не запомнить и не продиктовать. В me7 можно отправить деньги на имя вроде anna.base.eth и взять имя для своего адреса, не выходя из кошелька.',
      card: 'Платите на anna.base.eth вместо адреса и получите своё имя.',
      sections: [
        {
          h: 'Перевод по имени',
          p: [
            'Введите в поле получателя имя, которое заканчивается на .base.eth или .eth. Кошелёк найдёт его в открытом реестре в блокчейне и до подтверждения покажет адрес, на который оно ведёт, вместе с кодом этого адреса.',
            'Имя — только способ найти адрес. Сам перевод уходит на адрес, который вы увидели на экране.',
          ],
        },
        {
          h: 'Своё имя',
          list: [
            'На экране получения можно выбрать свободное имя и зарегистрировать его в реестре сети Base на год. Оно ведёт на ваш основной адрес.',
            'Платите в USDC: цена реестра и газ плюс 0,5 USDC. ETH не нужен. Длинные имена стоят в реестре несколько центов в год, короткие дороже.',
            'Имя — от трёх символов: строчные латинские буквы, цифры и дефис внутри.',
            'После этого имя показывается вверху кошелька и копируется одним нажатием.',
          ],
        },
        {
          h: 'Что стоит знать',
          list: [
            'Имя публично. Кто его знает, видит адрес за ним и историю этого адреса, поэтому давайте его тем, кому дали бы и сам адрес.',
            'Имя ведёт на основной адрес кошелька. Сменяемые адреса для USDC продолжают работать рядом с ним.',
            'Имя записано в реестре сети Base, а не у me7: оно остаётся вашим вместе с ключом, и его понимают другие кошельки, которые читают этот реестр.',
          ],
        },
      ],
      faq: [
        { q: 'На какие имена можно отправлять?', a: 'На имена, которые заканчиваются на .base.eth и .eth. Если имя не зарегистрировано или к нему не привязан адрес, кошелёк скажет об этом и ничего не отправит.' },
        { q: 'Нужен ли плательщику me7, чтобы заплатить на моё имя?', a: 'Нет. Ваш адрес по имени найдёт любой кошелёк, который понимает такие имена.' },
        { q: 'Что будет через год?', a: 'Регистрация действует год, её можно продлить в реестре сети Base.' },
      ],
    },
  },
  {
    id: 'safesend',
    en: {
      slug: 'safe-transfer',
      title: 'Address code, 10 seconds to cancel, a receipt — me7',
      description: 'me7 guards a transfer from a swapped or mistyped address: an eight-digit address code to compare, ten seconds to cancel after confirming, and a receipt once it is sent.',
      h1: 'A transfer that is hard to send to the wrong place',
      lead: 'A crypto transfer cannot be taken back, and the usual way to lose money is a wrong address: mistyped, or quietly replaced in the clipboard. me7 puts three plain checks between you and that mistake.',
      card: 'An address code to compare, ten seconds to cancel, a receipt after sending.',
      sections: [
        {
          h: 'The address code',
          p: [
            'Every address has a short code in me7: eight digits and a small pattern, computed from the address itself. The recipient sees it on their receive screen; you see it under the recipient field, however the address got there: typed, pasted or scanned.',
            'Ask the recipient to read their eight digits. If they match yours, the address is theirs. Comparing eight digits by voice or in a message takes seconds; comparing forty characters nobody really does.',
          ],
        },
        {
          h: 'Ten seconds to cancel',
          p: [
            'After you confirm a transfer, me7 waits ten seconds before sending anything to the network. During the count one button cancels it, for free and without a trace. Sure of it? Another button sends at once.',
          ],
        },
        {
          h: 'A receipt after sending',
          p: [
            'When the transfer is sent, the wallet shows what went: the amount, the recipient, the fee, the time and the transfer’s number in the network, which opens it in a public explorer.',
          ],
        },
        {
          h: 'What else stands guard',
          list: [
            'Fake look-alikes: an address whose beginning and end match one you know, with a different middle, is called out before you send, and transfers planted from such addresses are hidden from your history.',
            'Frozen addresses: before USDT is sent on Tron, the wallet asks the token itself whether the recipient is frozen by its issuer, and does not send money where it would be stuck.',
            'Before USDC is sent, every address is checked against lists of scam and sanctioned addresses.',
            'The scanner acts only on addresses and payment links; a code with anything else in it is not followed.',
            'With a Ledger, the address and the amount are read on the device’s own screen.',
          ],
        },
      ],
      faq: [
        { q: 'Does the address code work only with a QR code?', a: 'No. The code is computed from the address, so it shows for any address in the recipient field: typed, pasted, scanned or found by name.' },
        { q: 'Can I cancel a transfer after the ten seconds?', a: 'No. Once a transfer is in the network, nobody can take it back: not you, not me7. The ten seconds are the last moment to change your mind.' },
        { q: 'Does the recipient need me7 to tell me the code?', a: 'The code is shown by me7, on the receive screen. If the recipient uses another wallet, compare the address itself the way you usually do; the ten seconds and the receipt work all the same.' },
      ],
    },
    ru: {
      slug: 'zaschita-perevoda',
      title: 'Код адреса, 10 секунд на отмену и отчёт о переводе — me7',
      description: 'me7 защищает перевод от подменённого или ошибочного адреса: восьмизначный код адреса для сверки, десять секунд на отмену после подтверждения и отчёт после отправки.',
      h1: 'Перевод, который трудно отправить не туда',
      lead: 'Перевод в криптовалюте нельзя вернуть, а чаще всего деньги теряют из-за неверного адреса: с опечаткой или тихо подменённого в буфере обмена. me7 ставит между вами и такой ошибкой три простые проверки.',
      card: 'Код адреса для сверки, десять секунд на отмену, отчёт после отправки.',
      sections: [
        {
          h: 'Код адреса',
          p: [
            'У каждого адреса в me7 есть короткий код: восемь цифр и маленький узор, вычисленные из самого адреса. Получатель видит его на экране получения, а вы под полем получателя, каким бы путём адрес туда ни попал: набран, вставлен или отсканирован.',
            'Попросите получателя назвать свои восемь цифр. Совпали с вашими — адрес его. Сверить восемь цифр голосом или в переписке можно за секунды, а сорок символов на деле не сверяет никто.',
          ],
        },
        {
          h: 'Десять секунд на отмену',
          p: [
            'После подтверждения me7 ждёт десять секунд и только потом отправляет перевод в сеть. Пока идёт отсчёт, одна кнопка отменяет его, бесплатно и без следа. Уверены? Другая кнопка отправит сразу.',
          ],
        },
        {
          h: 'Отчёт после отправки',
          p: [
            'Когда перевод отправлен, кошелёк показывает, что ушло: сумму, получателя, комиссию, время и номер перевода в сети, по которому он открывается в публичном обозревателе.',
          ],
        },
        {
          h: 'Что ещё стоит на страже',
          list: [
            'Адреса-подделки: адрес, у которого начало и конец совпадают со знакомым вам, а середина другая, кошелёк назовёт до отправки, а переводы, подброшенные с таких адресов, скроет из истории.',
            'Замороженные адреса: перед отправкой USDT в сети Tron кошелёк спрашивает сам токен, не заморожен ли получатель его эмитентом, и не отправляет деньги туда, где они застрянут.',
            'Перед отправкой USDC каждый адрес сверяется со списками мошеннических и санкционных адресов.',
            'Сканер исполняет только адреса и платёжные ссылки; код с чем-либо другим внутри он не открывает.',
            'С Ledger адрес и сумма читаются на экране самого устройства.',
          ],
        },
      ],
      faq: [
        { q: 'Код адреса работает только с QR-кодом?', a: 'Нет. Код вычисляется из адреса, поэтому показывается для любого адреса в поле получателя: набранного, вставленного, отсканированного или найденного по имени.' },
        { q: 'Можно ли отменить перевод после десяти секунд?', a: 'Нет. Когда перевод ушёл в сеть, вернуть его не может никто: ни вы, ни me7. Десять секунд — последний момент, чтобы передумать.' },
        { q: 'Нужен ли получателю me7, чтобы назвать код?', a: 'Код показывает me7 на экране получения. Если у получателя другой кошелёк, сверьте сам адрес так, как делаете обычно; десять секунд и отчёт работают в любом случае.' },
      ],
    },
  },
  {
    id: 'ethless',
    en: {
      slug: "usdt-ethereum-without-eth",
      title: "Send USDT and USDC on Ethereum without ETH — me7",
      description: "Send USDT or USDC on Ethereum from an address that holds no ETH. me7 lends the gas and takes one fee in the same coin. Your key signs; me7 cannot change the transfer.",
      h1: "USDT and USDC on Ethereum, with no ETH on the address",
      lead: "A token on Ethereum moves only in a transaction of its owner, and a transaction is paid for in ETH. If your address has none, me7 lends exactly the gas the transfer burns and takes its fee in the coin you send.",
      card: "USDT and USDC on Ethereum go without ETH: me7 lends the gas.",
      sections: [
        {
          h: "How it works",
          p: [
            "You sign two ordinary transfers with your own key: the fee to me7 and the payment to the recipient. me7 cannot change either of them; it can only deliver them or not.",
            "me7 puts on your address exactly the ETH the two will burn and hands all three transactions to the block builders as one bundle. They go into a block together or not at all.",
          ],
        },
        {
          h: "How to use it",
          steps: [
            "Open send and choose USDT or USDC on Ethereum.",
            "Enter the address and the amount. If the address has too little ETH for the gas, the wallet switches to me7’s service by itself.",
            "Check the fee on the review screen and confirm with your password.",
            "Wait for the wallet to say how it ended: usually 5 to 25 seconds, two minutes at most.",
          ],
        },
        {
          h: "What it costs",
          list: [
            "me7’s part: 1.3 dollars, taken in the coin you send.",
            "The gas me7 lends, with a tenth added for the price of ETH moving. In a quiet network that is a few cents.",
            "The whole fee is shown before you confirm. The smallest payment is 5 dollars.",
          ],
        },
        {
          h: "What to keep in mind",
          list: [
            "If the bundle does not get into a block within two minutes, nothing is sent and nothing is charged: the wallet says so and you can send again.",
            "A little unspent ETH stays on your address: the gas is lent with room to spare, and the network takes what it actually used.",
            "When gas on Ethereum is very dear, the service asks to wait.",
            "With a Ledger it is not available.",
          ],
        },
      ],
      faq: [
        { q: "Do I need any ETH at all?", a: "No. If the address has none, me7 lends what the transfer burns. If it has enough, the wallet sends the ordinary way and you pay the network yourself." },
        { q: "Can me7 redirect my transfer?", a: "No. Each of the two transfers is signed whole by your key: the recipient and the amount cannot be changed. me7 can only send them to the network or decline to." },
        { q: "Which coins does it work for?", a: "USDT and USDC on Ethereum. Other tokens on Ethereum still need ETH on the address." },
      ],
    },
    ru: {
      slug: "usdt-ethereum-bez-eth",
      title: "Отправка USDT и USDC в Ethereum без ETH — me7",
      description: "Отправляйте USDT и USDC в сети Ethereum с адреса, на котором нет ETH. me7 даёт газ и берёт одну комиссию в той же монете. Подписывает ваш ключ: изменить перевод me7 не может.",
      h1: "USDT и USDC в Ethereum, когда на адресе нет ETH",
      lead: "Токен в Ethereum двигается только транзакцией своего владельца, а транзакция оплачивается в ETH. Если на вашем адресе его нет, me7 даёт ровно столько газа, сколько сожжёт перевод, и берёт комиссию в той монете, которую вы отправляете.",
      card: "USDT и USDC в Ethereum уходят без ETH: газ даёт me7.",
      sections: [
        {
          h: "Как это работает",
          p: [
            "Вы подписываете своим ключом два обычных перевода: комиссию me7 и платёж получателю. Изменить их me7 не может: он может только доставить их в сеть или не доставить.",
            "me7 кладёт на ваш адрес ровно столько ETH, сколько сожгут оба перевода, и отдаёт все три транзакции сборщикам блоков одним пакетом. Они попадают в блок вместе или не попадают совсем.",
          ],
        },
        {
          h: "Как пользоваться",
          steps: [
            "Откройте «отправить» и выберите USDT или USDC в сети Ethereum.",
            "Введите адрес и сумму. Если на адресе не хватает ETH на газ, кошелёк сам переключится на сервис me7.",
            "Проверьте комиссию на экране подтверждения и подтвердите паролем.",
            "Дождитесь, пока кошелёк скажет, чем всё кончилось: обычно 5–25 секунд, самое большее две минуты.",
          ],
        },
        {
          h: "Сколько это стоит",
          list: [
            "Часть me7: 1,3 доллара, в той монете, которую вы отправляете.",
            "Газ, который даёт me7, с надбавкой в десятую часть на случай, если цена ETH сдвинется. В спокойной сети это несколько центов.",
            "Вся комиссия видна до подтверждения. Наименьший платёж: 5 долларов.",
          ],
        },
        {
          h: "Что нужно знать",
          list: [
            "Если пакет не попал в блок за две минуты, ничего не отправлено и ничего не списано: кошелёк скажет об этом, и перевод можно повторить.",
            "На адресе остаётся немного неизрасходованного ETH: газ даётся с запасом, а сеть берёт по факту.",
            "Когда газ в Ethereum очень дорог, сервис просит подождать.",
            "С Ledger этот способ недоступен.",
          ],
        },
      ],
      faq: [
        { q: "Нужен ли вообще ETH?", a: "Нет. Если на адресе его нет, me7 даёт столько, сколько сожжёт перевод. Если ETH хватает, кошелёк отправляет обычным путём, и сеть вы оплачиваете сами." },
        { q: "Может ли me7 перенаправить мой перевод?", a: "Нет. Каждый из двух переводов целиком подписан вашим ключом: получателя и сумму изменить нельзя. me7 может только отправить их в сеть или отказаться." },
        { q: "Для каких монет это работает?", a: "Для USDT и USDC в сети Ethereum. Остальным токенам в Ethereum по-прежнему нужен ETH на адресе." },
      ],
    },
  },
  {
    id: 'bridge',
    en: {
      slug: "swap-between-networks",
      title: "Swap coins between networks without buying gas — me7",
      description: "Swap USDC on Base, USDT and USDC on Ethereum, or USDT on Tron for a coin on another network. me7 pays the gas; the result arrives on your own address.",
      h1: "A swap from one network to another, in one step",
      lead: "Moving value from one network to another usually means an exchange, or a bridge and gas on both sides. In me7 it is one screen: choose what you give and what you get, and the result arrives on your own address on the other network.",
      card: "Swap a coin for a coin on another network; me7 pays the gas.",
      sections: [
        {
          h: "How it works",
          p: [
            "You choose two coins on the swap screen. If they are on different networks, the wallet sends what you give to a crossing service, and the service delivers what it buys to your own address on the other network.",
            "USDC on Base, USDT and USDC on Ethereum, and USDT on Tron leave through me7’s own service: it pays the network and takes its fee in the coin you give. Other coins leave your main address by an ordinary transfer, and you pay the gas yourself.",
          ],
        },
        {
          h: "What can be swapped",
          list: [
            "You give: USDC on Base; ETH, USDT, USDC, DAI, LINK, WBTC or cbBTC on Ethereum; ETH or cbBTC on Base; USDT on Tron.",
            "You get: any coin of the wallet on another network, including USDT and TRX on Tron and bitcoin.",
            "USDT on Tron is taken from 101 USDT: the crossing service accepts nothing smaller from that network. Giving TRX or bitcoin is not available yet.",
          ],
        },
        {
          h: "What it costs",
          list: [
            "The crossing service’s own price, which is in the amount you are shown: a fraction of a percent on stablecoins.",
            "me7’s fee when its service carries the deposit: about 1 USDC from Base; 1.3 dollars and the gas from Ethereum. It is shown as a line of its own before you confirm.",
            "When you pay the gas yourself, me7 takes nothing.",
          ],
        },
        {
          h: "What to keep in mind",
          list: [
            "Between the networks the money goes through a third party, NEAR Intents. While the swap runs, the money is in that service’s hands. If it cannot make the swap, it returns the money to your address; me7’s fee is not returned.",
            "The wallet works out for itself the least a swap may give, from prices it gets elsewhere, and refuses a rate worse than that.",
            "USDC on Base is taken from one pocket at a time. If the amount is there only in the stealth pocket and the ordinary one together, the wallet asks before it joins them: that ties their addresses on the blockchain.",
            "Most swaps arrive within a minute. Bitcoin takes about a quarter of an hour.",
          ],
        },
      ],
      faq: [
        { q: "Where does the result arrive?", a: "On your own address on the other network, in this same wallet. The crossing service is told that address and no other." },
        { q: "Do I need gas on the network I swap to?", a: "No. The crossing service delivers the coin there by itself." },
        { q: "Who holds the money during the swap?", a: "The crossing service, NEAR Intents, for the minute the swap takes. me7 does not hold it at any point." },
      ],
    },
    ru: {
      slug: "obmen-mezhdu-setyami",
      title: "Обмен монет между сетями без покупки газа — me7",
      description: "Меняйте USDC в Base, USDT и USDC в Ethereum или USDT в Tron на монету в другой сети. Газ платит me7, результат приходит на ваш же адрес.",
      h1: "Обмен из одной сети в другую за один шаг",
      lead: "Перенести деньги из одной сети в другую обычно значит идти на биржу или через мост и держать газ с обеих сторон. В me7 это один экран: выбираете, что отдаёте и что получаете, и результат приходит на ваш же адрес в другой сети.",
      card: "Обмен монеты на монету в другой сети; газ платит me7.",
      sections: [
        {
          h: "Как это работает",
          p: [
            "На экране обмена вы выбираете две монеты. Если они в разных сетях, кошелёк отправляет то, что вы отдаёте, сервису перехода, а тот доставляет купленное на ваш же адрес в другой сети.",
            "USDC из Base, USDT и USDC из Ethereum и USDT из Tron уходят через собственный сервис me7: он платит сеть и берёт комиссию в той монете, которую вы отдаёте. Остальные монеты уходят с основного адреса обычным переводом, и газ вы платите сами.",
          ],
        },
        {
          h: "Что можно менять",
          list: [
            "Отдаёте: USDC в Base; ETH, USDT, USDC, DAI, LINK, WBTC или cbBTC в Ethereum; ETH или cbBTC в Base; USDT в Tron.",
            "Получаете: любую монету кошелька в другой сети, в том числе USDT и TRX в Tron и биткоин.",
            "USDT из Tron принимается от 101 USDT: меньше сервис перехода из этой сети не берёт. Отдавать TRX и биткоин пока нельзя.",
          ],
        },
        {
          h: "Сколько это стоит",
          list: [
            "Цена самого сервиса перехода: она уже в сумме, которую вам показывают, и на стейблкоинах это доли процента.",
            "Комиссия me7, когда депозит несёт его сервис: около 1 USDC из Base; 1,3 доллара и газ из Ethereum. Она стоит отдельной строкой до подтверждения.",
            "Когда газ вы платите сами, me7 не берёт ничего.",
          ],
        },
        {
          h: "Что нужно знать",
          list: [
            "Между сетями деньги идут через сторонний сервис NEAR Intents. Пока идёт обмен, деньги у этого сервиса. Если он не сможет обменять, он вернёт деньги на ваш адрес; комиссия me7 при этом не возвращается.",
            "Кошелёк сам считает по сторонним ценам, сколько обмен обязан дать самое меньшее, и не принимает курс хуже.",
            "USDC в Base берётся из одного кармана за раз. Если сумма набирается только из stealth-кармана и обычного вместе, кошелёк спросит, прежде чем их объединить: это свяжет их адреса в блокчейне.",
            "Большинство обменов приходит в течение минуты. Биткоин идёт около четверти часа.",
          ],
        },
      ],
      faq: [
        { q: "Куда приходит результат?", a: "На ваш же адрес в другой сети, в этом же кошельке. Сервису перехода называется именно он и никакой другой." },
        { q: "Нужен ли газ в сети, в которую я меняю?", a: "Нет. Сервис перехода сам доставляет туда монету." },
        { q: "У кого деньги во время обмена?", a: "У сервиса перехода NEAR Intents, ту минуту, что идёт обмен. me7 не держит их ни в какой момент." },
      ],
    },
  },
  {
    id: 'quarantine',
    en: {
      slug: "address-quarantine",
      title: "Quarantine of one address: money from a listed sender — me7",
      description: "If money reaches you from a sanctioned, frozen or known scam address, me7 puts only that one address of yours in quarantine. The rest of the wallet works as usual.",
      h1: "One bad payment does not spoil the whole wallet",
      lead: "Nobody can stop money from arriving: an address is public, and anyone may pay to it. What me7 does is look at who paid. If the sender is on a list, only the address of yours that was paid goes into quarantine.",
      card: "Money from a listed sender quarantines one address, not the wallet.",
      sections: [
        {
          h: "How it works",
          p: [
            "The wallet looks at the payments that arrived on your addresses and asks the lists about each sender: the sanctions list, and the lists of addresses frozen by the coin’s issuer (Circle for USDC, Tether for USDT). me7’s service makes the same check on its own side, with a public list of scam addresses as well.",
            "An address that was paid a dollar or more by a listed sender is marked in red. me7’s service no longer carries transfers from it, so the wallet pays round it. Your other addresses and pockets are untouched.",
          ],
        },
        {
          h: "What you can do with a quarantined address",
          list: [
            "The money is still yours. You move it out by an ordinary transfer, paying the network yourself.",
            "For USDC on Base the wallet has a button for it: it says how much ETH the address needs, waits for it, and sends the whole balance where you say.",
            "For USDT on Tron it is the ordinary transfer paid in TRX.",
            "It cannot be moved to another address of the same wallet: that would only carry the cause along, unseen.",
          ],
        },
        {
          h: "What it does not do",
          list: [
            "It sees the direct sender only. Money that passed through someone else on its way is not seen.",
            "It knows the public lists and the issuers’ freezes, not what a paid analytics firm thinks of an address.",
            "It looks a year back.",
            "So an address without a mark is not “clean”: it is an address with no direct payment from a listed sender. For a fuller opinion there is the AML check on request.",
          ],
        },
      ],
      faq: [
        { q: "Can someone switch my address off by sending it a cent?", a: "No. Less than a dollar from a listed sender is not counted." },
        { q: "Does me7 freeze my money?", a: "No. me7 has no key to your wallet. It declines to pay the gas for that one address; you can still send from it yourself." },
        { q: "Which coins are covered?", a: "USDC on Base, on all of the wallet’s addresses, and USDT on Tron. On Ethereum the service checks the address when it lends the gas." },
      ],
    },
    ru: {
      slug: "karantin-adresa",
      title: "Карантин одного адреса: деньги от отправителя из списков — me7",
      description: "Если вам пришли деньги с санкционного, замороженного или мошеннического адреса, me7 ставит на карантин только тот ваш адрес, куда они пришли. Остальной кошелёк работает как обычно.",
      h1: "Один плохой платёж не портит весь кошелёк",
      lead: "Запретить деньгам приходить нельзя: адрес виден всем, и прислать на него может кто угодно. me7 смотрит, кто прислал. Если отправитель в списках, на карантин уходит только тот ваш адрес, на который пришли эти деньги.",
      card: "Деньги от отправителя из списков закрывают один адрес, а не кошелёк.",
      sections: [
        {
          h: "Как это работает",
          p: [
            "Кошелёк смотрит на платежи, пришедшие на ваши адреса, и спрашивает списки о каждом отправителе: санкционный список и списки адресов, замороженных выпустившей монету компанией (Circle для USDC, Tether для USDT). Сервис me7 делает ту же проверку на своей стороне и сверяется ещё с открытым списком мошеннических адресов.",
            "Адрес, на который отправитель из списков прислал доллар или больше, помечается красным. Сервис me7 больше не проводит с него переводы, и кошелёк платит в обход него. Остальные ваши адреса и карманы это не затрагивает.",
          ],
        },
        {
          h: "Что можно сделать с адресом на карантине",
          list: [
            "Деньги остаются вашими. Вывести их можно обычным переводом, оплатив сеть самостоятельно.",
            "Для USDC в Base в кошельке есть кнопка: она говорит, сколько ETH нужно на адресе, дожидается его и отправляет весь остаток туда, куда вы укажете.",
            "Для USDT в Tron это обычный перевод с оплатой в TRX.",
            "На другой адрес этого же кошелька вывести нельзя: причина карантина просто переехала бы вместе с деньгами, уже незаметно.",
          ],
        },
        {
          h: "Чего это не делает",
          list: [
            "Видно только прямого отправителя. Деньги, которые по дороге прошли через кого-то ещё, не видны.",
            "Известны открытые списки и заморозки от выпустивших монету компаний, но не мнение платной аналитической фирмы об адресе.",
            "Проверка смотрит на год назад.",
            "Поэтому адрес без пометки не значит «чистый»: это адрес, на который не было прямого платежа от отправителя из списков. Для более полной оценки есть проверка AML по запросу.",
          ],
        },
      ],
      faq: [
        { q: "Можно ли отключить мой адрес, прислав на него цент?", a: "Нет. Меньше доллара от отправителя из списков не считается." },
        { q: "me7 замораживает мои деньги?", a: "Нет. У me7 нет ключа от вашего кошелька. Он отказывается платить газ за этот один адрес; отправить с него самостоятельно вы по-прежнему можете." },
        { q: "Какие монеты это касается?", a: "USDC в Base на всех адресах кошелька и USDT в Tron. В Ethereum адрес проверяет сервис, когда даёт газ." },
      ],
    },
  },
  {
    id: 'request',
    en: {
      slug: "payment-link",
      title: "Ask for a crypto payment with a link, paid from any network — me7",
      description: "Name an amount of USDC and send a link. The payer needs no wallet of yours: they pay USDC on Base, or USDT, ETH or bitcoin from another network, and the exact amount reaches you.",
      h1: "Ask for an amount, and send a link",
      lead: "Sending someone an address leaves them to work out the network, the coin and the amount. A request does that for them: one link opens a page that says how much, and lets them pay with what they have.",
      card: "Name an amount and send a link; it is paid from any of several networks.",
      sections: [
        {
          h: "How it works",
          p: [
            "On the receive screen you choose “request”, name an amount of USDC and, if you like, a few words about what it is for. The wallet gives you a link and a code for the screen.",
            "Whoever opens the link needs no me7 wallet and no account. They pay USDC on Base straight to your address, or another coin from another network; in that case a third party, NEAR Intents, makes the swap and delivers exactly the amount you asked for.",
            "me7’s own services take no part in such a payment, and me7 takes no fee. What the payer pays over the amount is the crossing service’s price and the network’s.",
          ],
        },
        {
          h: "How to use it",
          steps: [
            "Open “receive”, choose USDC, then “request”.",
            "Type the amount and what it is for, and choose how long the link stands: an hour or a day.",
            "Send the link, and tell the payer the eight-digit address code: the payment page shows the same digits.",
            "Watch the list of requests: it says which are paid.",
          ],
        },
        {
          h: "What the payer can pay with",
          list: [
            "USDC on Base, directly.",
            "USDT or USDC on Ethereum; ETH on Ethereum or Base; bitcoin.",
            "USDT on Tron, for requests of 101 USDC and more: the crossing service accepts nothing smaller from that network.",
          ],
        },
        {
          h: "What to keep in mind",
          list: [
            "A link can be rewritten by whoever passes it on, like any address sent in a message. The address code is there to catch that.",
            "Paying from another network puts the payer’s money in the crossing service’s hands while the swap runs. If it fails, the money returns to the refund address: the payer’s own, or a one-time address of yours on that network.",
            "The link’s time limit is the page’s rule. The address stays yours for good: money sent to it by hand later still arrives.",
            "Your address is not shown on the page unless the payer chooses to pay it directly, but it is inside the link itself.",
          ],
        },
      ],
      faq: [
        { q: "Does the payer need me7?", a: "No. The link opens an ordinary page; the payer sends from any wallet or exchange." },
        { q: "What does me7 charge for a request?", a: "Nothing. A payment by request does not go through me7’s services." },
        { q: "How do I know which request was paid?", a: "Each request has an address of its own among your changing addresses, so the wallet sees it, on any of your devices." },
        { q: "Can a request be paid twice?", a: "The page offers nothing to pay with once the request’s address has received the amount or its time is up. Someone who sends to the address by hand can still do so, and the money is yours." },
      ],
    },
    ru: {
      slug: "ssylka-na-oplatu",
      title: "Запрос оплаты в крипте по ссылке, из любой сети — me7",
      description: "Назовите сумму в USDC и отправьте ссылку. Плательщику ваш кошелёк не нужен: он платит USDC в Base либо USDT, ETH или биткоином из другой сети, а вам приходит точная сумма.",
      h1: "Назовите сумму и отправьте ссылку",
      lead: "Когда человеку присылают адрес, сеть, монету и сумму он подбирает сам. Запрос делает это за него: одна ссылка открывает страницу, где сказано, сколько, и где можно заплатить тем, что есть.",
      card: "Назовите сумму и отправьте ссылку; оплатить её можно из нескольких сетей.",
      sections: [
        {
          h: "Как это работает",
          p: [
            "На экране получения вы выбираете «request», называете сумму в USDC и, если хотите, пару слов о том, за что. Кошелёк выдаёт ссылку и код для экрана.",
            "Тому, кто откроет ссылку, не нужны ни кошелёк me7, ни аккаунт. Он платит USDC в Base прямо на ваш адрес либо другой монетой из другой сети; тогда обмен делает сторонний сервис NEAR Intents и доставляет ровно ту сумму, которую вы запросили.",
            "Собственные сервисы me7 в таком платеже не участвуют, и комиссию me7 не берёт. Всё, что плательщик платит сверх суммы, это цена сервиса перехода и сети.",
          ],
        },
        {
          h: "Как пользоваться",
          steps: [
            "Откройте «получить», выберите USDC, затем «request».",
            "Введите сумму и за что, выберите, сколько действует ссылка: час или день.",
            "Отправьте ссылку и назовите плательщику восемь цифр кода адреса: на странице оплаты он увидит те же цифры.",
            "Следите за списком запросов: в нём видно, какие оплачены.",
          ],
        },
        {
          h: "Чем может заплатить плательщик",
          list: [
            "USDC в сети Base, напрямую.",
            "USDT или USDC в Ethereum; ETH в Ethereum или Base; биткоин.",
            "USDT в Tron, для запросов от 101 USDC: меньше сервис перехода из этой сети не берёт.",
          ],
        },
        {
          h: "Что стоит помнить",
          list: [
            "Ссылку может переписать тот, кто её пересылает, как и любой адрес в сообщении. Код адреса нужен, чтобы это заметить.",
            "При оплате из другой сети деньги плательщика на время обмена оказываются у сервиса перехода. Если обмен не состоится, они вернутся на адрес возврата: собственный адрес плательщика или ваш одноразовый адрес в той сети.",
            "Срок ссылки это правило страницы. Адрес остаётся вашим навсегда: деньги, отправленные на него вручную позже, всё равно придут.",
            "Ваш адрес на странице не показан, пока плательщик не выберет оплату напрямую, но он есть внутри самой ссылки.",
          ],
        },
      ],
      faq: [
        { q: "Нужен ли плательщику me7?", a: "Нет. Ссылка открывает обычную страницу; плательщик отправляет с любого кошелька или биржи." },
        { q: "Сколько me7 берёт за запрос?", a: "Ничего. Платёж по запросу не проходит через сервисы me7." },
        { q: "Как понять, какой запрос оплачен?", a: "У каждого запроса свой адрес среди ваших сменных, поэтому кошелёк это видит, на любом вашем устройстве." },
        { q: "Можно ли оплатить запрос дважды?", a: "Страница не предложит платить, когда на адрес запроса уже пришла сумма или вышел срок. Тот, кто отправит на адрес вручную, сделать это по-прежнему может, и деньги ваши." },
      ],
    },
  },
  {
    id: 'walletcard',
    en: {
      slug: "apple-wallet-crypto-balance",
      title: "USDC balance as a card in Apple Wallet, with payment notices — me7",
      description: "A card in Apple Wallet on the iPhone: your USDC balance on Base, a code to receive by, and a lock-screen notice when a payment arrives. View only: nothing is sent from it.",
      h1: "Your balance as a card in Apple Wallet",
      lead: "To see whether a payment has come, a crypto wallet usually has to be opened and unlocked. me7 can put a card beside the bank cards in your iPhone: it shows the balance, tells you on the lock screen when money arrives, and carries the code a payer scans.",
      card: "The balance, a code to receive by and a notice when money arrives, in Wallet on the iPhone.",
      sections: [
        {
          h: "What the card shows",
          list: [
            "The balance in USDC on Base of the addresses you opened for it.",
            "A notice on the lock screen when money arrives, with the amount.",
            "A code to receive by: the payer scans it off your phone. Under it stands your name, if the address has one, or the address shortened.",
            "The eight-digit address code, to compare with the payer.",
            "On the back: the latest arrivals and outgoings, and when the card was last brought up to date.",
          ],
        },
        {
          h: "What me7’s service learns",
          p: [
            "This is the one part of me7 in which the service knows addresses of yours. To keep the card up to date it has to be told which addresses to watch, and it reads what they hold from the blockchain about every forty seconds. The wallet says so before a card is made, and nothing is sent until you agree.",
            "The service is given no keys and can send nothing from your addresses. You choose what to open: the main address alone, or all of the pocket’s addresses. The one-time addresses of stealth payments are never opened.",
            "Notices reach the phone through Apple: Apple learns that your card has changed, not what is on it.",
            "The service forgets the card and its addresses when you remove the card from the phone, when you press “remove the card” in the wallet, or a day after it was made if no phone took it.",
          ],
        },
        {
          h: "How to add it",
          steps: [
            "Open me7 in Safari on the iPhone and sign in.",
            "Open the “card” tab and choose which addresses to open.",
            "Tick that you understand what the service will know, and press “Add to Apple Wallet”.",
            "Confirm in the sheet the phone shows. The card appears in Wallet.",
          ],
        },
        {
          h: "What to keep in mind",
          list: [
            "The card is not a payment card and has nothing to do with Apple Pay: it cannot pay in a shop, and nothing can be sent from it.",
            "It shows USDC on Base only. Other coins and other networks are not on it.",
            "The balance on the card can be up to a minute behind the blockchain.",
            "Whoever holds your unlocked phone sees the balance and the address, as they would see any card in Wallet.",
            "me7 takes no fee for the card.",
            "Apple Wallet and iPhone are trademarks of Apple Inc. me7 is not affiliated with Apple.",
          ],
        },
      ],
      faq: [
        { q: "Can I pay with this card?", a: "No. It shows the balance and receives notices. Payments are made in the wallet itself, signed with your key." },
        { q: "Does me7’s service see my whole wallet?", a: "Only the addresses you open for the card, and only what anyone can read about them in the blockchain. It holds no keys." },
        { q: "How do I make the service forget my addresses?", a: "Remove the card from Wallet on the phone, or press “remove the card” in the wallet’s “card” tab. The card and its addresses are deleted from the service." },
        { q: "Does it work on Android?", a: "No. The card is a pass for Apple Wallet and is added on an iPhone." },
        { q: "How fast does the notice come?", a: "The service looks at the addresses about every forty seconds, and the phone is told as soon as the sum has changed." },
      ],
    },
    ru: {
      slug: "kartochka-apple-wallet",
      title: "Остаток USDC в Apple Wallet и уведомление о поступлении — me7",
      description: "Карточка в Apple Wallet на iPhone: остаток USDC в сети Base, код для получения и уведомление на экране блокировки о платеже. Только показывает: отправить с неё нельзя.",
      h1: "Остаток карточкой в Apple Wallet",
      lead: "Чтобы узнать, пришёл ли платёж, криптокошелёк обычно надо открыть и разблокировать. me7 может положить карточку рядом с банковскими картами в iPhone: она показывает остаток, сообщает на экране блокировки о поступлении и несёт код, который сканирует плательщик.",
      card: "Остаток, код для получения и уведомление о поступлении, в Wallet на iPhone.",
      sections: [
        {
          h: "Что показывает карточка",
          list: [
            "Остаток в USDC в сети Base на адресах, которые вы для неё открыли.",
            "Уведомление на экране блокировки, когда приходят деньги, с суммой.",
            "Код для получения: плательщик сканирует его с вашего телефона. Под ним стоит ваше имя, если оно есть у адреса, или сокращённый адрес.",
            "Восемь цифр кода адреса, чтобы сверить с плательщиком.",
            "На обороте: последние поступления и списания и время последнего обновления.",
          ],
        },
        {
          h: "Что узнаёт сервис me7",
          p: [
            "Это единственное место в me7, где сервис знает ваши адреса. Чтобы карточка обновлялась, ему нужно сказать, за какими адресами следить, и он читает их остаток из блокчейна примерно раз в сорок секунд. Кошелёк говорит об этом до того, как сделать карточку, и ничего не отправляет без вашего согласия.",
            "Ключей сервис не получает и отправить с ваших адресов ничего не может. Что открыть, выбираете вы: один основной адрес или все адреса кармана. Одноразовые адреса платежей stealth не открываются никогда.",
            "Уведомления приходят на телефон через Apple: Apple узнаёт, что ваша карточка изменилась, но не что на ней.",
            "Сервис забывает карточку и её адреса, когда вы удаляете карточку с телефона, когда нажимаете «удалить карточку» в кошельке, или через сутки после создания, если её не добавили ни на один телефон.",
          ],
        },
        {
          h: "Как добавить",
          steps: [
            "Откройте me7 в Safari на iPhone и войдите.",
            "Откройте вкладку «карта» и выберите, какие адреса открыть.",
            "Отметьте, что понимаете, что узнает сервис, и нажмите «Добавить в Apple Wallet».",
            "Подтвердите в окне, которое покажет телефон. Карточка появится в Wallet.",
          ],
        },
        {
          h: "Что стоит помнить",
          list: [
            "Карточка не платёжная и к Apple Pay отношения не имеет: расплатиться ею в магазине нельзя, отправить с неё ничего нельзя.",
            "Она показывает только USDC в сети Base. Других монет и сетей на ней нет.",
            "Остаток на карточке может отставать от блокчейна до минуты.",
            "Тот, у кого в руках ваш разблокированный телефон, видит остаток и адрес, как видел бы любую карту в Wallet.",
            "За карточку me7 ничего не берёт.",
            "Apple Wallet и iPhone — товарные знаки Apple Inc. me7 не связан с Apple.",
          ],
        },
      ],
      faq: [
        { q: "Можно ли платить этой карточкой?", a: "Нет. Она показывает остаток и получает уведомления. Платежи делаются в самом кошельке и подписываются вашим ключом." },
        { q: "Видит ли сервис me7 весь мой кошелёк?", a: "Только адреса, которые вы открыли для карточки, и только то, что о них может прочитать в блокчейне кто угодно. Ключей у него нет." },
        { q: "Как сделать, чтобы сервис забыл мои адреса?", a: "Удалите карточку из Wallet на телефоне или нажмите «удалить карточку» во вкладке «карта». Карточка и её адреса стираются с сервиса." },
        { q: "Работает ли на Android?", a: "Нет. Карточка сделана для Apple Wallet и добавляется на iPhone." },
        { q: "Как быстро приходит уведомление?", a: "Сервис смотрит на адреса примерно раз в сорок секунд и сообщает телефону, как только сумма изменилась." },
      ],
    },
  },
  {
    id: 'aml',
    en: {
      slug: "aml-check",
      title: "AML check of any crypto address, no account — me7",
      description: "Check any address for ties to sanctions, hacks and fraud right from the wallet. No sign-up; one report costs 0.20 USDC and me7’s fee. The screening service does not see who asked.",
      h1: "A risk report on any address, when you want one",
      lead: "Before you accept a payment or send one, you may want to know what an address is tied to. me7 buys a report from a screening service for you: you type the address, pay in USDC, and read the answer a moment later.",
      card: "A risk report on any address, bought from the wallet without an account.",
      sections: [
        {
          h: "How it works",
          p: [
            "The report comes from a third party, BlockSec. You pay me7 in USDC on Base, without gas; me7’s service buys the report with what you have just paid and passes the answer on.",
            "BlockSec sees me7 and the address asked about. It does not see who asked. It does keep the address it was asked about.",
          ],
        },
        {
          h: "How to use it",
          steps: [
            "Open “check an address (AML)” at the foot of the main screen, or “check this address” under the recipient field when sending.",
            "Paste the address. For addresses of the Ethereum kind, choose the network.",
            "Check the price and confirm with your password.",
            "Read the report: the risk score, what the service marked, and its whole answer if you want it.",
          ],
        },
        {
          h: "What it costs",
          list: [
            "The report: 0.20 USDC.",
            "me7’s fee for carrying the payment: about 1 USDC.",
            "Both are shown before you confirm. If the payment went through and the report did not come, you can ask again without paying for a day.",
          ],
        },
        {
          h: "What to keep in mind",
          list: [
            "It is one service’s rating, not a guarantee. An exchange may use another service and see the address differently.",
            "Networks: Ethereum, Base, Tron, Bitcoin, BNB Chain, Polygon, Arbitrum, Optimism, Avalanche.",
            "It needs USDC on Base in the wallet.",
          ],
        },
      ],
      faq: [
        { q: "Do I need an account with the screening service?", a: "No. There is no account and no key: each report is paid for by itself." },
        { q: "Can I check an address that is not mine?", a: "Yes, any address: an exchange’s, a counterparty’s, your own." },
        { q: "Is this the same as the quarantine?", a: "No. The quarantine is automatic and free, and looks only at direct payments from listed senders. The AML check is a paid report from an analytics service, on request." },
      ],
    },
    ru: {
      slug: "aml-proverka",
      title: "AML-проверка любого криптоадреса без аккаунта — me7",
      description: "Проверьте любой адрес на связь с санкциями, взломами и мошенничеством прямо из кошелька. Без регистрации; отчёт стоит 0,20 USDC и комиссию me7.",
      h1: "Отчёт о риске по любому адресу, когда он нужен",
      lead: "Перед тем как принять платёж или отправить его, бывает нужно понять, с чем связан адрес. me7 покупает для вас отчёт у проверяющего сервиса: вы вставляете адрес, платите в USDC и через минуту читаете ответ.",
      card: "Отчёт о риске по любому адресу, прямо из кошелька и без аккаунта.",
      sections: [
        {
          h: "Как это работает",
          p: [
            "Отчёт даёт сторонний сервис BlockSec. Вы платите me7 в USDC в сети Base, без газа; сервис me7 покупает отчёт на то, что вы только что заплатили, и передаёт вам ответ.",
            "BlockSec видит me7 и адрес, о котором спросили. Кто спрашивал, он не видит. Сам адрес, о котором спросили, он запоминает.",
          ],
        },
        {
          h: "Как пользоваться",
          steps: [
            "Откройте «проверить адрес (AML)» внизу главного экрана или «проверить этот адрес» под полем получателя при отправке.",
            "Вставьте адрес. Для адресов вида Ethereum выберите сеть.",
            "Проверьте цену и подтвердите паролем.",
            "Прочитайте отчёт: оценку риска, что отметил сервис, и его ответ целиком, если он вам нужен.",
          ],
        },
        {
          h: "Сколько это стоит",
          list: [
            "Отчёт: 0,20 USDC.",
            "Комиссия me7 за проведение платежа: около 1 USDC.",
            "Обе суммы видны до подтверждения. Если оплата прошла, а отчёт не пришёл, запрос можно повторить без оплаты в течение суток.",
          ],
        },
        {
          h: "Что нужно знать",
          list: [
            "Это оценка одного сервиса, а не гарантия. Биржа может пользоваться другим сервисом и видеть адрес иначе.",
            "Сети: Ethereum, Base, Tron, Bitcoin, BNB Chain, Polygon, Arbitrum, Optimism, Avalanche.",
            "В кошельке нужны USDC в сети Base.",
          ],
        },
      ],
      faq: [
        { q: "Нужен ли аккаунт у проверяющего сервиса?", a: "Нет. Ни аккаунта, ни ключа: каждый отчёт оплачивается сам по себе." },
        { q: "Можно ли проверить чужой адрес?", a: "Да, любой: адрес биржи, адрес того, с кем вы имеете дело, свой собственный." },
        { q: "Это то же самое, что карантин?", a: "Нет. Карантин работает сам и бесплатно и смотрит только на прямые платежи от отправителей из списков. AML-проверка — это платный отчёт аналитического сервиса, по запросу." },
      ],
    },
  },
  {
    id: 'cross',
    en: {
      slug: 'private-usdt-tron',
      title: 'Pay USDT on Tron from a fresh address, out of USDC — me7',
      description: 'Pay USDT on Tron without showing your Tron address. me7 turns your USDC on Base into USDT on a new one-time Tron address and pays from it. No TRX needed.',
      h1: 'USDT on Tron, paid from an address with no past',
      lead: 'Whoever you pay in USDT on Tron sees the address you paid from: what it holds and everyone it ever paid. me7 can pay from an address made for that one payment instead, funded from your USDC on Base.',
      card: 'Pay USDT on Tron from a one-time address, out of your USDC on Base.',
      sections: [
        {
          h: 'How it works',
          p: [
            'You type the recipient’s Tron address and how much USDT they must get. The wallet makes a new Tron address from your recovery phrase, one that has never been used.',
            'Your USDC on Base crosses to Tron and arrives on that address as USDT. The wallet then pays the recipient from it, the exact amount, and the address is not used again.',
          ],
        },
        {
          h: 'How to use it',
          steps: [
            'Open send, choose USDT on Tron and switch to “stealth via USDC”.',
            'Enter the recipient’s address and the amount in USDT.',
            'Check the screen: what the recipient gets, what leaves your USDC, and each of the three fees.',
            'Confirm with your password. Keep the page open for a minute or two, until the screen says the transfer is delivered.',
          ],
        },
        {
          h: 'USDT and USDC on Ethereum too',
          p: [
            'The same payment works for USDT and USDC on Ethereum: choose the coin on Ethereum, switch to “stealth via USDC”, and the money crosses from your USDC on Base to a new Ethereum address used once. me7 lends the gas for the payment from it, so no ETH is needed. The fees there are the ordinary ones: about 1 USDC on Base, the crossing, and 1.3 dollars and the gas on Ethereum.',
          ],
        },
        {
          h: 'What it costs',
          list: [
            'me7’s fee for sending the USDC: 0.5 USDC and the gas.',
            'The crossing from Base to Tron: set by the crossing service, about two percent on small amounts.',
            'me7’s fee for sending the USDT: 1 USDT and what the Tron network takes. You need no TRX.',
            'All three are shown before you confirm. The smallest payment is 5 USDT.',
          ],
        },
        {
          h: 'What to keep in mind',
          list: [
            'Between Base and Tron the money goes through a third party, NEAR Intents. While it crosses, the money is in that service’s hands, and the wallet cannot check the delivery beforehand. If the exchange is not made, by the service’s rules the USDC goes back to your address on Base.',
            'It is protection from prying eyes, not anonymity. The recipient sees a fresh address. The crossing service shows publicly which operation on Base funded it, so it is strongest when you pay with stealth money, whose addresses are tied to nothing of yours.',
            'The second step is signed by your open wallet. If the page closes midway, nothing is lost: the wallet offers to finish the transfer the next time you open it in the same browser.',
            'With a Ledger it is not available.',
          ],
        },
      ],
      faq: [
        { q: 'Do I need TRX or ETH for this?', a: 'No. me7 pays the network on both sides, and its fees are taken in USDC and in USDT. They are shown before you confirm.' },
        { q: 'Can the recipient see my main Tron address?', a: 'No. They see the one-time address the payment came from. It holds nothing else and has no history.' },
        { q: 'What happens if I close the wallet during the transfer?', a: 'The USDT waits on the one-time address, which only your wallet can spend from. Open the wallet again in the same browser and it offers to finish the transfer.' },
        { q: 'Who holds the money while it crosses?', a: 'The crossing service, NEAR Intents. me7 does not hold it at any point: the wallet sends the USDC to the service and receives the USDT on your own address.' },
      ],
    },
    ru: {
      slug: 'privatnyy-usdt-tron',
      title: 'Оплата USDT в Tron с нового адреса, из USDC — me7',
      description: 'Платите USDT в сети Tron, не показывая свой адрес. me7 превращает ваши USDC в Base в USDT на новом одноразовом адресе Tron и платит с него. TRX не нужен.',
      h1: 'USDT в Tron с адреса без прошлого',
      lead: 'Тот, кому вы платите USDT в сети Tron, видит адрес, с которого пришли деньги: сколько на нём лежит и кому с него платили. me7 может заплатить с адреса, созданного для одного этого платежа, а деньги взять из ваших USDC в Base.',
      card: 'Оплата USDT в Tron с одноразового адреса, из ваших USDC в Base.',
      sections: [
        {
          h: 'Как это работает',
          p: [
            'Вы вводите адрес получателя в Tron и сумму в USDT, которую он должен получить. Кошелёк создаёт из вашей фразы восстановления новый адрес Tron, которым ещё никто не пользовался.',
            'Ваши USDC из Base переходят в Tron и приходят на этот адрес уже как USDT. С него кошелёк платит получателю ровно нужную сумму, и больше адрес не используется.',
          ],
        },
        {
          h: 'Как пользоваться',
          steps: [
            'Откройте «отправить», выберите USDT в сети Tron и переключитесь на «stealth через USDC».',
            'Введите адрес получателя и сумму в USDT.',
            'Проверьте экран: сколько получит получатель, сколько спишется USDC и каждую из трёх комиссий.',
            'Подтвердите паролем. Не закрывайте страницу одну-две минуты, пока экран не скажет, что перевод доставлен.',
          ],
        },
        {
          h: 'Так же для USDT и USDC в Ethereum',
          p: [
            'Тот же платёж работает для USDT и USDC в сети Ethereum: выберите монету в Ethereum, переключитесь на «stealth через USDC», и деньги перейдут из ваших USDC в Base на новый одноразовый адрес Ethereum. Газ для платежа с него даёт me7, так что ETH не нужен. Комиссии там обычные: около 1 USDC в Base, переход и 1,3 доллара с газом в Ethereum.',
          ],
        },
        {
          h: 'Сколько это стоит',
          list: [
            'Комиссия me7 за отправку USDC: 0,5 USDC и газ.',
            'Переход из Base в Tron: цену назначает сервис перехода, на небольших суммах около двух процентов.',
            'Комиссия me7 за отправку USDT: 1 USDT и расходы сети Tron. TRX вам не нужен.',
            'Все три видны до подтверждения. Наименьший платёж: 5 USDT.',
          ],
        },
        {
          h: 'Что нужно знать',
          list: [
            'Между Base и Tron деньги идут через сторонний сервис NEAR Intents. Пока они в пути, они у этого сервиса, и проверить доставку заранее кошелёк не может. Если обмен не состоится, по правилам сервиса USDC возвращаются на ваш адрес в Base.',
            'Это защита от посторонних глаз, а не полная скрытность. Получатель видит свежий адрес. Сервис перехода публично показывает, какая операция в Base его пополнила, поэтому сильнее всего это работает, когда вы платите стелс-деньгами: их адреса ни с чем вашим не связаны.',
            'Второй шаг подписывает ваш открытый кошелёк. Если страница закроется на полпути, ничего не пропадёт: кошелёк предложит завершить перевод, когда вы снова откроете его в том же браузере.',
            'С Ledger этот способ недоступен.',
          ],
        },
      ],
      faq: [
        { q: 'Нужен ли для этого TRX или ETH?', a: 'Нет. Сеть с обеих сторон оплачивает me7, а его комиссии берутся в USDC и в USDT. Они видны до подтверждения.' },
        { q: 'Увидит ли получатель мой основной адрес в Tron?', a: 'Нет. Он увидит одноразовый адрес, с которого пришёл платёж. На нём больше ничего нет, и истории у него нет.' },
        { q: 'Что будет, если закрыть кошелёк во время перевода?', a: 'USDT останутся ждать на одноразовом адресе, с которого может платить только ваш кошелёк. Откройте кошелёк снова в том же браузере, и он предложит завершить перевод.' },
        { q: 'У кого деньги, пока они переходят из сети в сеть?', a: 'У сервиса перехода NEAR Intents. me7 не держит их ни в какой момент: кошелёк отправляет USDC сервису и получает USDT на ваш собственный адрес.' },
      ],
    },
  },
  {
    id: 'stealth',
    en: {
      slug: 'stealth-addresses',
      title: 'Stealth addresses for USDC: one code, a new address each time — me7',
      description: 'Give out one code that never changes. Everyone who pays by it from me7 pays USDC to a new address only you can find and spend from. No ETH needed. ERC-5564.',
      h1: 'One code, a new address for every payer',
      lead: 'An address tells everyone who has it what you hold and who pays you. A stealth code tells them nothing. You give out one code; each payer’s wallet makes a fresh address from it, and only your wallet can find the money and spend it.',
      card: 'One code that never changes; every payment lands on its own address.',
      sections: [
        {
          h: 'How it works',
          p: [
            'The code holds two of your public keys. The payer’s wallet takes them, adds a key it uses once, and works out an address nobody has seen before. The USDC goes there, and beside the payment a short note is left on the blockchain.',
            'To everyone else the note is random bytes. Your wallet reads the notes, recognises its own with a viewing key, and works out the private key of that address. Nobody else can do either.',
          ],
        },
        {
          h: 'What stealth addresses usually lack, and me7 has',
          list: [
            'Gas. A fresh address has no ETH, and sending it some from your own address would tie the two together. In me7 USDC moves by signature and the service pays the gas, so the address never needs ETH.',
            'A long address. The code is about 140 characters. In me7 it travels as a QR code or by the copy button, and eight digits let payer and receiver check it is the right one.',
            'A separate app. The stealth addresses sit in the same balance as the rest of your USDC and are spent the same way.',
          ],
        },
        {
          h: 'How to use it',
          steps: [
            'Open receive, choose USDC on Base and switch to stealth mode.',
            'Show the QR code or copy the code and send it to whoever pays you. The same code can go to many people.',
            'The payer scans it or pastes it into the recipient field in me7, checks the eight digits with you, and sends.',
            'The money appears in your balance. Spend it like any other USDC.',
            'Someone you pay often? Save their code as a contact: it is then one tap away when sending, and it can be paid in a batch together with ordinary addresses.',
          ],
        },
        {
          h: 'What to keep in mind',
          list: [
            'It works from me7 to me7. The standard (ERC-5564) is open and a few other wallets follow it, so you may try them, but for now we recommend me7 on both sides. Ordinary wallets and exchanges will not understand the code: give them the rotating address.',
            'It is for USDC on Base. With a Ledger it is not available: the device cannot sign with a key worked out on the fly.',
            'It is protection from prying eyes, not anonymity. Amounts and times are always visible on the blockchain; when you spend from several stealth addresses in one payment, they become linked to each other.',
            'The wallet keeps stealth money apart from the rest. A stealth code is paid with stealth money, an ordinary address with ordinary money, and the two are joined only after a warning and your consent. When sending you can also name the pocket yourself.',
          ],
        },
      ],
      faq: [
        { q: 'How is this different from a rotating address?', a: 'A rotating address is made by your wallet and is good for one payer: each one needs a fresh one. A stealth code is given once to everybody, and each payer’s wallet makes the address. Rotation works with any wallet; the stealth code needs me7 on the paying side.' },
        { q: 'Can someone who has my code see my payments?', a: 'No. With the code one can only pay you. Finding the payments takes your viewing key, and spending them takes your spending key; both come from your recovery phrase and never leave your browser.' },
        { q: 'What if I lose the device?', a: 'Nothing is lost. The keys come from the same 24 words as the rest of the wallet, and the wallet reads the blockchain again to find the payments.' },
      ],
    },
    ru: {
      slug: 'stels-adresa',
      title: 'Стелс-адреса для USDC: один код, каждый раз новый адрес — me7',
      description: 'Дайте один постоянный код. Каждый, кто платит по нему из me7, платит USDC на новый адрес, который найти и потратить можете только вы. Без ETH. Стандарт ERC-5564.',
      h1: 'Один код, новый адрес для каждого плательщика',
      lead: 'Адрес рассказывает каждому, у кого он есть, сколько у вас денег и кто вам платит. Стелс-код не рассказывает ничего. Вы даёте один код, кошелёк каждого плательщика делает по нему новый адрес, а найти деньги и потратить их может только ваш кошелёк.',
      card: 'Один постоянный код; каждый платёж приходит на свой адрес.',
      sections: [
        {
          h: 'Как это работает',
          p: [
            'В коде два ваших открытых ключа. Кошелёк плательщика берёт их, добавляет ключ, который использует один раз, и вычисляет адрес, которого раньше никто не видел. USDC уходят на него, а рядом с платежом в блокчейне остаётся короткая записка.',
            'Для всех остальных записка — случайные байты. Ваш кошелёк читает записки, узнаёт свою ключом просмотра и вычисляет закрытый ключ этого адреса. Никто другой не может ни того, ни другого.',
          ],
        },
        {
          h: 'Чего стелс-адресам обычно не хватает и что есть в me7',
          list: [
            'Газ. На новом адресе нет ETH, а пополнить его со своего адреса значит связать их между собой. В me7 USDC уходит по подписи, а газ платит сервис, поэтому ETH на таком адресе не нужен вообще.',
            'Длинный адрес. Код занимает около 140 символов. В me7 он передаётся QR-кодом или кнопкой «копировать», а восемь цифр позволяют плательщику и получателю сверить, что код тот самый.',
            'Отдельное приложение. Стелс-адреса лежат в том же балансе, что и остальные ваши USDC, и тратятся так же.',
          ],
        },
        {
          h: 'Как пользоваться',
          steps: [
            'Откройте «получить», выберите USDC в сети Base и переключитесь на stealth mode.',
            'Покажите QR-код или скопируйте код и отправьте тому, кто вам платит. Один и тот же код можно дать многим.',
            'Плательщик сканирует его или вставляет в поле получателя в me7, сверяет с вами восемь цифр и отправляет.',
            'Деньги появляются в вашем балансе. Тратьте их как любые другие USDC.',
            'Часто платите одному человеку? Сохраните его код в контакты: при отправке он выбирается одним нажатием, и ему можно платить в рассылке вместе с обычными адресами.',
          ],
        },
        {
          h: 'Что стоит знать',
          list: [
            'Работает из me7 в me7. Стандарт (ERC-5564) открытый, и некоторые другие кошельки его поддерживают, так что пробовать можно, но пока мы советуем me7 с обеих сторон. Обычные кошельки и биржи код не поймут: им давайте сменяемый адрес.',
            'Только USDC в сети Base. С Ledger недоступно: устройство не умеет подписывать ключом, который вычисляется на лету.',
            'Это защита от посторонних глаз, а не анонимность. Суммы и время в блокчейне видны всегда; когда вы одним платежом тратите с нескольких стелс-адресов, они становятся связаны между собой.',
            'Кошелёк держит стелс-деньги отдельно от остальных. По стелс-коду платят стелс-деньги, на обычный адрес обычные, а объединяются они только после предупреждения и вашего согласия. При отправке карман можно выбрать и самому.',
          ],
        },
      ],
      faq: [
        { q: 'Чем это отличается от сменяемого адреса?', a: 'Сменяемый адрес делает ваш кошелёк, и он годится для одного плательщика: каждому нужен свежий. Стелс-код даётся один раз всем, а адрес делает кошелёк плательщика. Смена адресов работает с любым кошельком, для стелс-кода плательщику нужен me7.' },
        { q: 'Может ли тот, у кого есть мой код, видеть мои платежи?', a: 'Нет. По коду можно только заплатить вам. Чтобы найти платежи, нужен ваш ключ просмотра, чтобы потратить — ключ расходования; оба получаются из вашей фразы восстановления и не покидают браузер.' },
        { q: 'Что будет, если я потеряю устройство?', a: 'Ничего не пропадёт. Ключи получаются из тех же 24 слов, что и весь кошелёк, а кошелёк заново прочитает блокчейн и найдёт платежи.' },
      ],
    },
  },
];
