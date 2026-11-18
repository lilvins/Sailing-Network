/**
 * Every page's stylesheet, in the order the pages used to be imported.
 *
 * The pages' code is fetched when a page opens (App.tsx), but their styles must
 * not be: a stylesheet that arrives later lands after the site-wide pixel UI
 * (main.tsx) and would win over it. So the styles stay in the first load, in
 * this fixed order, and the built stylesheet is the same as before the split.
 * A new page adds its stylesheet at the end of this list.
 */
import "../features/home/home.css";
import "../features/login/login.css";
import "../features/profiles/profiles.css";
import "@fontsource/silkscreen/400.css";
import "@fontsource/silkscreen/700.css";
import "@fontsource/vt323/400.css";
import "../features/pixel/pixel.css";
import "../features/duel-room/duelroom.css";
import "../features/stats/stats.css";
import "../features/social/social.css";
import "../features/social/messagesPopup.css";
import "../features/social/meta/meta.css";
import "../features/deck-builder/deckbuilder.css";
import "../features/deck-builder/mydecks.css";
import "../features/popular/popular.css";
import "../features/admin/admin.css";
import "../features/credits/credits.css";
import "../features/board/board.css";
import "../features/board/boarddb.css";
import "../features/board/board2.css";
import "../features/board-auto/boardauto.css";
import "@fontsource/pixelify-sans/400.css";
import "@fontsource/pixelify-sans/600.css";
import "../features/board-bot/boardbot.css";
import "../features/account/account.css";
