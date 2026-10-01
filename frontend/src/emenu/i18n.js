// Guest-facing strings. The staff app's catalogue isn't loaded here to keep
// the menu bundle small; item names come from the restaurant as written.
const dict = {
  ar: {
    menu: 'المنيو', table: 'طاولة', search: 'ابحث في المنيو', add: 'إضافة', addToCart: 'أضف للطلب', cart: 'طلبك',
    viewCart: 'عرض الطلب', items: 'صنف', total: 'الإجمالي', estTotal: 'الإجمالي قبل الضريبة والخدمة', notes: 'ملاحظات',
    notesPh: 'مثلاً: بدون بصل', orderNotesPh: 'ملاحظة للمطعم', name: 'الاسم', phone: 'رقم الموبايل', send: 'إرسال الطلب',
    required: 'إجباري', optional: 'اختياري', chooseUpTo: 'اختر حتى {0}', chooseAtLeast: 'اختر {0} على الأقل', chooseOne: 'اختر واحد',
    callWaiter: 'نداء الويتر', askBill: 'طلب الحساب', waiterComing: 'تم إبلاغ الويتر، جاي حالاً', billComing: 'الحساب جاي حالاً',
    pending: 'طلبك وصل للمطعم', pendingSub: 'بانتظار التأكيد من الكاشير…', accepted: 'تم تأكيد طلبك', acceptedSub: 'رقم طلبك {0} — جاري التحضير',
    rejected: 'تعذر قبول الطلب', expired: 'لم يتم الرد على الطلب', expiredSub: 'من فضلك نادِ الويتر أو حاول مرة أخرى',
    newOrder: 'طلب جديد', backToMenu: 'العودة للمنيو', closed: 'المنيو غير متاح حالياً', closedSub: 'حاول مرة أخرى بعد قليل',
    empty: 'لا توجد أصناف', noResults: 'لا توجد نتائج', browseOnly: 'للطلب نادِ الويتر', takeaway: 'تيك أواي', dineIn: 'على الطاولة',
    contact: 'تواصل معنا', directions: 'الاتجاهات', call: 'اتصال', whatsapp: 'واتساب', remove: 'حذف', retry: 'إعادة المحاولة',
    error: 'حدث خطأ، حاول مرة أخرى', yourOrder: 'تفاصيل الطلب', poweredBy: 'CPro POS', language: 'اللغة', close: 'إغلاق', increase: 'زيادة', decrease: 'تقليل',
    currency: { EGP: 'ج.م', SAR: 'ر.س', AED: 'د.إ', USD: '$' },
  },
  en: {
    menu: 'Menu', table: 'Table', search: 'Search the menu', add: 'Add', addToCart: 'Add to order', cart: 'Your order',
    viewCart: 'View order', items: 'items', total: 'Total', estTotal: 'Total before tax and service', notes: 'Notes',
    notesPh: 'e.g. no onions', orderNotesPh: 'Note for the restaurant', name: 'Name', phone: 'Mobile number', send: 'Send order',
    required: 'Required', optional: 'Optional', chooseUpTo: 'Choose up to {0}', chooseAtLeast: 'Choose at least {0}', chooseOne: 'Choose one',
    callWaiter: 'Call waiter', askBill: 'Ask for the bill', waiterComing: 'The waiter is on the way', billComing: 'Your bill is on the way',
    pending: 'Your order reached the restaurant', pendingSub: 'Waiting for the cashier to confirm…', accepted: 'Order confirmed', acceptedSub: 'Order #{0} — being prepared',
    rejected: 'Order could not be accepted', expired: 'No reply to your order', expiredSub: 'Please call the waiter or try again',
    newOrder: 'New order', backToMenu: 'Back to menu', closed: 'The menu is not available right now', closedSub: 'Please try again shortly',
    empty: 'No items', noResults: 'No results', browseOnly: 'Call the waiter to order', takeaway: 'Takeaway', dineIn: 'At the table',
    contact: 'Contact us', directions: 'Directions', call: 'Call', whatsapp: 'WhatsApp', remove: 'Remove', retry: 'Retry',
    error: 'Something went wrong, try again', yourOrder: 'Order details', poweredBy: 'CPro POS', language: 'Language', close: 'Close', increase: 'Increase', decrease: 'Decrease',
    currency: { EGP: 'EGP', SAR: 'SAR', AED: 'AED', USD: '$' },
  },
  fr: {
    menu: 'Menu', table: 'Table', search: 'Rechercher', add: 'Ajouter', addToCart: 'Ajouter à la commande', cart: 'Votre commande',
    viewCart: 'Voir la commande', items: 'articles', total: 'Total', estTotal: 'Total hors taxes et service', notes: 'Remarques',
    notesPh: 'ex. sans oignons', orderNotesPh: 'Remarque pour le restaurant', name: 'Nom', phone: 'Numéro de mobile', send: 'Envoyer la commande',
    required: 'Obligatoire', optional: 'Facultatif', chooseUpTo: "Jusqu'à {0}", chooseAtLeast: 'Au moins {0}', chooseOne: 'Choisissez-en un',
    callWaiter: 'Appeler le serveur', askBill: "Demander l'addition", waiterComing: 'Le serveur arrive', billComing: "L'addition arrive",
    pending: 'Commande reçue par le restaurant', pendingSub: 'En attente de confirmation…', accepted: 'Commande confirmée', acceptedSub: 'Commande n° {0} — en préparation',
    rejected: 'Commande refusée', expired: 'Pas de réponse à votre commande', expiredSub: 'Appelez le serveur ou réessayez',
    newOrder: 'Nouvelle commande', backToMenu: 'Retour au menu', closed: "Le menu n'est pas disponible", closedSub: 'Réessayez dans un instant',
    empty: 'Aucun article', noResults: 'Aucun résultat', browseOnly: 'Appelez le serveur pour commander', takeaway: 'À emporter', dineIn: 'À table',
    contact: 'Nous contacter', directions: 'Itinéraire', call: 'Appeler', whatsapp: 'WhatsApp', remove: 'Retirer', retry: 'Réessayer',
    error: 'Une erreur est survenue', yourOrder: 'Détails de la commande', poweredBy: 'CPro POS', language: 'Langue', close: 'Fermer', increase: 'Augmenter', decrease: 'Diminuer',
    currency: { EGP: 'EGP', SAR: 'SAR', AED: 'AED', USD: '$' },
  },
};

export const langNames = { ar: 'العربية', en: 'English', fr: 'Français' };
const KEY = 'cpro.menu.lang';

export function pickLang(available, fallback) {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch { /* blocked */ }
  const nav = (navigator.language || '').slice(0, 2);
  return [saved, fallback, nav, 'ar'].find((l) => l && available.includes(l)) || available[0] || 'ar';
}

export function saveLang(l) {
  try { localStorage.setItem(KEY, l); } catch { /* blocked */ }
}

export function makeT(lang) {
  const d = dict[lang] || dict.ar;
  const t = (k, args) => {
    let s = d[k] ?? dict.ar[k] ?? k;
    if (args) s = String(s).replace(/\{(\d+)\}/g, (m, i) => args[i] ?? m);
    return s;
  };
  t.lang = lang;
  t.dir = lang === 'ar' ? 'rtl' : 'ltr';
  t.locale = { ar: 'ar-EG', en: 'en-GB', fr: 'fr-FR' }[lang];
  t.currency = (c) => d.currency[c] || c;
  return t;
}
