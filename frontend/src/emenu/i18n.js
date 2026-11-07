// Guest-facing strings. The staff app's catalogue isn't loaded here to keep
// the menu bundle small; item names come from the restaurant as written.
const dict = {
  ar: {
    installTitle: 'ثبّت تطبيق {0}', installSub: 'اطلب بسرعة أكبر من الشاشة الرئيسية لهاتفك، دون البحث عن الرابط.', install: 'تثبيت التطبيق', notNow: 'ليس الآن',
    iosStep1: 'اضغط زر المشاركة أسفل متصفح Safari', iosStep2: 'اختر «إضافة إلى الشاشة الرئيسية»', gotIt: 'حسناً',
    myDetails: 'بياناتي', detailsSub: 'تُرسَل مع طلبك ليصلك على نحو صحيح', inHall: 'في الصالة', delivery: 'توصيل', tableNumber: 'رقم الطاولة',
    chooseTable: 'اختر الطاولة', address: 'العنوان', addressPh: 'المنطقة، الشارع، رقم المبنى والشقة، علامة مميزة', detailsSaved: 'حُفظت بياناتك',
    detailsNote: 'تُخزَّن بياناتك على هاتفك فقط، وتُرسَل إلى المطعم مع الطلب.', deliverTo: 'التوصيل إلى', needTable: 'اختر الطاولة', needAddress: 'أدخل اسمك ورقم هاتفك وعنوانك',
    edit: 'تعديل', addDetails: 'أكمل بياناتك', subtotal: 'الأصناف', deliveryFee: 'رسوم التوصيل',
    home: 'الرئيسية', menuTab: 'قائمة الطعام', cartTab: 'السلة', offers: 'العروض', profile: 'بياناتي', popular: 'الأكثر طلباً', viewAll: 'عرض الكل',
    familyOffers: 'عروض العائلة', filter: 'تصفية', category: 'القسم', allCats: 'الكل', priceRange: 'السعر', from: 'من', to: 'إلى',
    apply: 'تطبيق', reset: 'إلغاء التصفية', searchMeal: 'ابحث عن وجبتك…', badge_bestseller: 'الأكثر مبيعاً', badge_hot_deal: 'عرض ساخن', badge_new: 'جديد',
    noOffers: 'لا توجد عروض حالياً', cartEmpty: 'سلتك فارغة', cartEmptySub: 'اختر ما يعجبك من قائمة الطعام وأضفه إلى السلة', browseMenu: 'تصفّح قائمة الطعام',
    confirmOrder: 'تأكيد الطلب',
    previewOnly: 'هذه معاينة — لن يُرسَل أي شيء', previewBanner: 'معاينة قائمة الطعام',
    save: 'حفظ',
    menu: 'قائمة الطعام', table: 'طاولة', search: 'ابحث في قائمة الطعام', add: 'إضافة', addToCart: 'أضف إلى السلة', cart: 'سلتك',
    viewCart: 'عرض الطلب', items: 'صنف', total: 'الإجمالي', estTotal: 'الإجمالي (قبل الضريبة والخدمة)', notes: 'ملاحظات',
    notesPh: 'مثلاً: دون بصل', orderNotesPh: 'ملاحظة للمطعم', name: 'الاسم', phone: 'رقم الهاتف المحمول', send: 'إرسال الطلب',
    required: 'إلزامي', optional: 'اختياري', chooseUpTo: 'اختر حتى {0}', chooseAtLeast: 'اختر {0} على الأقل', chooseOne: 'اختر واحداً',
    callWaiter: 'نداء النادل', askBill: 'طلب الفاتورة', waiterComing: 'أُبلغ النادل، وهو في طريقه إليك', billComing: 'الفاتورة في طريقها إليك',
    orderPlaced: 'تم إرسال طلبك', etaSub: 'يُتوقَّع وصوله خلال {0} دقيقة', etaNone: 'سنجهّزه في أسرع وقت', accepted: 'تم تأكيد طلبك', acceptedSub: 'رقم طلبك {0}',
    orderReady: 'طلبك جاهز', readyHall: 'سيصل إلى طاولتك حالاً', readyDelivery: 'سيخرج للتوصيل حالاً', orderDone: 'شكراً لطلبك', orderDoneSub: 'نرجو أن يكون الطعام قد نال إعجابك',
    notifications: 'الإشعارات', noNotifications: 'لا توجد إشعارات', noNotificationsSub: 'ستظهر حالة طلبك هنا بعد الطلب', includes: 'يشمل', prepAbout: 'نحو {0} دقيقة',
    needHelp: 'هل تحتاج إلى مساعدة؟', foodIssue: 'مشكلة في الطعام', issuePh: 'ما المشكلة؟ (اختياري)', sendIssue: 'إرسال', issueSent: 'وصلنا بلاغك، وسنأتي إليك حالاً',
    readyToOrder: 'نحن جاهزون للطلب', orderComing: 'النادل في طريقه لأخذ طلبكم', needExtras: 'نحتاج إلى شيء', extrasComing: 'طلبك في الطريق',
    orderLate: 'تأخر طلبنا', lateSent: 'أبلغنا المطبخ، وسنتابع طلبك حالاً', otherRequest: 'طلب آخر', otherPh: 'اكتب طلبك', otherSent: 'وصلنا طلبك',
    sentMark: 'أُرسل', payHow: 'كيف ستدفع؟', payCash: 'نقداً', payCard: 'بطاقة مصرفية', extrasWhat: 'ماذا تحتاجون؟', extrasPh: 'شيء آخر؟ (اختياري)',
    extra_water: 'ماء', extra_napkins: 'مناديل', extra_cutlery: 'أدوات المائدة', extra_ice: 'ثلج', extra_plates: 'أطباق إضافية', extra_clean: 'تنظيف الطاولة',
    contactTab: 'تواصل', contactSub: 'اطلب ما تحتاج إليه من طاولتك، وسيأتيك النادل', youAreAt: 'أنت على', backToCart: 'متابعة الطلب', askStaff: 'اطلب من النادل',
    askStaffInPerson: 'لأي طلب، نادِ النادل',
    yourBill: 'فاتورتك', yourBillSub: 'اطّلع على المستحق عليكم حتى الآن', seeBill: 'عرض الفاتورة', billEmpty: 'لا توجد فاتورة على الطاولة بعد',
    billEmptySub: 'تظهر الطلبات هنا فور تأكيد المطعم لها', discount: 'خصم', serviceCharge: 'خدمة', tax: 'ضريبة', paidAlready: 'مدفوع',
    amountDue: 'المستحق', refresh: 'تحديث', askBillHow: 'اطلب الفاتورة — كيف ستدفع؟',
    needName: 'أدخل اسمك', needPhone: 'أدخل رقم هاتفك المحمول', badPhone: 'رقم الهاتف غير صحيح', needAddressOnly: 'أدخل عنوانك',
    rejected: 'تعذّر قبول الطلب', expired: 'لم يُرَدّ على الطلب', expiredSub: 'يُرجى مناداة النادل أو إعادة المحاولة',
    newOrder: 'طلب جديد', backToMenu: 'العودة إلى قائمة الطعام', closed: 'قائمة الطعام غير متاحة حالياً', closedSub: 'أعد المحاولة بعد قليل',
    empty: 'لا توجد أصناف', noResults: 'لا توجد نتائج', browseOnly: 'للطلب، نادِ النادل', takeaway: 'طلب خارجي', dineIn: 'على الطاولة',
    contact: 'تواصل معنا', directions: 'الاتجاهات', call: 'اتصال', whatsapp: 'واتساب', remove: 'حذف', retry: 'إعادة المحاولة',
    error: 'حدث خطأ، أعد المحاولة', yourOrder: 'تفاصيل الطلب', poweredBy: 'CPro POS', language: 'اللغة', close: 'إغلاق', increase: 'زيادة', decrease: 'إنقاص',
    currency: { EGP: 'ج.م', SAR: 'ر.س', AED: 'د.إ', USD: '$' },
  },
  en: {
    installTitle: 'Get the {0} app', installSub: 'Order faster from your home screen, without looking for the link.', install: 'Install app', notNow: 'Not now',
    iosStep1: 'Tap the Share button in Safari', iosStep2: 'Choose “Add to Home Screen”', gotIt: 'Got it',
    myDetails: 'My details', detailsSub: 'Sent with your order so it reaches you', inHall: 'In the hall', delivery: 'Delivery', tableNumber: 'Table number',
    chooseTable: 'Choose your table', address: 'Address', addressPh: 'Area, street, building and flat, landmark', detailsSaved: 'Details saved',
    detailsNote: 'Your details stay on this phone and are sent to the restaurant with your order.', deliverTo: 'Deliver to', needTable: 'Choose your table', needAddress: 'Enter your name, phone and address',
    edit: 'Edit', addDetails: 'Add your details', subtotal: 'Items', deliveryFee: 'Delivery fee',
    home: 'Home', menuTab: 'Menu', cartTab: 'Cart', offers: 'Offers', profile: 'My details', popular: 'Popular picks', viewAll: 'View all',
    familyOffers: 'Family deals', filter: 'Filter', category: 'Category', allCats: 'All', priceRange: 'Price', from: 'From', to: 'To',
    apply: 'Apply', reset: 'Clear filter', searchMeal: 'Search your favourite meal…', badge_bestseller: 'Bestseller', badge_hot_deal: 'Hot deal', badge_new: 'New',
    noOffers: 'No offers right now', cartEmpty: 'Your cart is empty', cartEmptySub: 'Pick something from the menu and add it to your cart', browseMenu: 'Browse the menu',
    confirmOrder: 'Confirm order',
    previewOnly: 'Preview only — nothing is sent', previewBanner: 'Menu preview',
   
   
    save: 'Save',
   
    menu: 'Menu', table: 'Table', search: 'Search the menu', add: 'Add', addToCart: 'Add to cart', cart: 'Your cart',
    viewCart: 'View order', items: 'items', total: 'Total', estTotal: 'Total before tax and service', notes: 'Notes',
    notesPh: 'e.g. no onions', orderNotesPh: 'Note for the restaurant', name: 'Name', phone: 'Mobile number', send: 'Send order',
    required: 'Required', optional: 'Optional', chooseUpTo: 'Choose up to {0}', chooseAtLeast: 'Choose at least {0}', chooseOne: 'Choose one',
    callWaiter: 'Call waiter', askBill: 'Ask for the bill', waiterComing: 'The waiter is on the way', billComing: 'Your bill is on the way',
    orderPlaced: 'Your order is placed', etaSub: 'Expected within {0} minutes', etaNone: 'We’ll get it ready as soon as we can', accepted: 'Order confirmed', acceptedSub: 'Order #{0}',
    orderReady: 'Your order is ready', readyHall: 'It’s on its way to your table', readyDelivery: 'It’s leaving for delivery now', orderDone: 'Thanks for your order', orderDoneSub: 'We hope you enjoyed it',
    notifications: 'Notifications', noNotifications: 'No notifications', noNotificationsSub: 'Your order status will appear here', includes: 'Includes', prepAbout: 'About {0} min',
    needHelp: 'Need help?', foodIssue: 'Problem with the food', issuePh: 'What went wrong? (optional)', sendIssue: 'Send', issueSent: 'Got it, someone is coming to you',
    readyToOrder: 'Ready to order', orderComing: 'A waiter is coming to take your order', needExtras: 'We need something', extrasComing: 'On its way',
    orderLate: 'Our order is late', lateSent: 'We told the kitchen and will check on your order', otherRequest: 'Something else', otherPh: 'Write your request', otherSent: 'Request received',
    sentMark: 'Sent', payHow: 'How will you pay?', payCash: 'Cash', payCard: 'Card', extrasWhat: 'What do you need?', extrasPh: 'Anything else? (optional)',
    extra_water: 'Water', extra_napkins: 'Napkins', extra_cutlery: 'Cutlery', extra_ice: 'Ice', extra_plates: 'Extra plates', extra_clean: 'Clean the table',
    contactTab: 'Contact', contactSub: 'Ask for anything from your table and a waiter will come', youAreAt: 'You are at', backToCart: 'Continue order', askStaff: 'Ask the staff',
    askStaffInPerson: 'Please ask a waiter for anything you need',
    yourBill: 'Your bill', yourBillSub: 'See what your table owes so far', seeBill: 'See the bill', billEmpty: 'Nothing on your table’s bill yet',
    billEmptySub: 'Orders appear here once the restaurant confirms them', discount: 'Discount', serviceCharge: 'Service', tax: 'Tax', paidAlready: 'Paid',
    amountDue: 'Amount due', refresh: 'Refresh', askBillHow: 'Ask for the bill — how will you pay?',
    needName: 'Enter your name', needPhone: 'Enter your mobile number', badPhone: 'This mobile number isn’t valid', needAddressOnly: 'Enter your address',
    rejected: 'Order could not be accepted', expired: 'No reply to your order', expiredSub: 'Please call the waiter or try again',
    newOrder: 'New order', backToMenu: 'Back to menu', closed: 'The menu is not available right now', closedSub: 'Please try again shortly',
    empty: 'No items', noResults: 'No results', browseOnly: 'Call the waiter to order', takeaway: 'Takeaway', dineIn: 'At the table',
    contact: 'Contact us', directions: 'Directions', call: 'Call', whatsapp: 'WhatsApp', remove: 'Remove', retry: 'Retry',
    error: 'Something went wrong, try again', yourOrder: 'Order details', poweredBy: 'CPro POS', language: 'Language', close: 'Close', increase: 'Increase', decrease: 'Decrease',
    currency: { EGP: 'EGP', SAR: 'SAR', AED: 'AED', USD: '$' },
  },
  fr: {
    installTitle: 'Installez l’app {0}', installSub: 'Commandez plus vite depuis votre écran d’accueil.', install: 'Installer l’app', notNow: 'Plus tard',
    iosStep1: 'Touchez le bouton Partager dans Safari', iosStep2: 'Choisissez « Sur l’écran d’accueil »', gotIt: 'Compris',
    myDetails: 'Mes infos', detailsSub: 'Envoyées avec votre commande', inHall: 'En salle', delivery: 'Livraison', tableNumber: 'Numéro de table',
    chooseTable: 'Choisissez votre table', address: 'Adresse', addressPh: 'Quartier, rue, immeuble et appartement, repère', detailsSaved: 'Infos enregistrées',
    detailsNote: 'Vos infos restent sur ce téléphone et sont envoyées au restaurant avec la commande.', deliverTo: 'Livrer à', needTable: 'Choisissez votre table', needAddress: 'Indiquez nom, téléphone et adresse',
    edit: 'Modifier', addDetails: 'Compléter mes infos', subtotal: 'Articles', deliveryFee: 'Frais de livraison',
    home: 'Accueil', menuTab: 'Menu', cartTab: 'Panier', offers: 'Offres', profile: 'Mes infos', popular: 'Les plus demandés', viewAll: 'Tout voir',
    familyOffers: 'Offres famille', filter: 'Filtrer', category: 'Catégorie', allCats: 'Tout', priceRange: 'Prix', from: 'De', to: 'À',
    apply: 'Appliquer', reset: 'Effacer le filtre', searchMeal: 'Rechercher un plat…', badge_bestseller: 'Best-seller', badge_hot_deal: 'Bon plan', badge_new: 'Nouveau',
    noOffers: 'Aucune offre pour le moment', cartEmpty: 'Votre panier est vide', cartEmptySub: 'Choisissez un plat du menu et ajoutez-le au panier', browseMenu: 'Voir le menu',
    confirmOrder: 'Confirmer la commande',
    previewOnly: 'Aperçu uniquement — rien n’est envoyé', previewBanner: 'Aperçu du menu',
   
   
    save: 'Enregistrer',
   
    menu: 'Menu', table: 'Table', search: 'Rechercher', add: 'Ajouter', addToCart: 'Ajouter au panier', cart: 'Votre panier',
    viewCart: 'Voir la commande', items: 'articles', total: 'Total', estTotal: 'Total hors taxes et service', notes: 'Remarques',
    notesPh: 'ex. sans oignons', orderNotesPh: 'Remarque pour le restaurant', name: 'Nom', phone: 'Numéro de mobile', send: 'Envoyer la commande',
    required: 'Obligatoire', optional: 'Facultatif', chooseUpTo: "Jusqu'à {0}", chooseAtLeast: 'Au moins {0}', chooseOne: 'Choisissez-en un',
    callWaiter: 'Appeler le serveur', askBill: "Demander l'addition", waiterComing: 'Le serveur arrive', billComing: "L'addition arrive",
    orderPlaced: 'Votre commande est passée', etaSub: 'Prévue d’ici {0} minutes', etaNone: 'Nous la préparons au plus vite', accepted: 'Commande confirmée', acceptedSub: 'Commande n° {0}',
    orderReady: 'Votre commande est prête', readyHall: 'Elle arrive à votre table', readyDelivery: 'Elle part en livraison', orderDone: 'Merci pour votre commande', orderDoneSub: 'Nous espérons que vous vous êtes régalé',
    notifications: 'Notifications', noNotifications: 'Aucune notification', noNotificationsSub: 'Le statut de votre commande apparaîtra ici', includes: 'Comprend', prepAbout: 'Environ {0} min',
    needHelp: 'Besoin d’aide ?', foodIssue: 'Problème avec le plat', issuePh: 'Quel est le problème ? (facultatif)', sendIssue: 'Envoyer', issueSent: 'Bien reçu, quelqu’un arrive',
    readyToOrder: 'Prêts à commander', orderComing: 'Un serveur vient prendre votre commande', needExtras: 'Il nous faut…', extrasComing: 'C’est en route',
    orderLate: 'Notre commande tarde', lateSent: 'La cuisine est prévenue, on vérifie votre commande', otherRequest: 'Autre demande', otherPh: 'Écrivez votre demande', otherSent: 'Demande reçue',
    sentMark: 'Envoyé', payHow: 'Comment payez-vous ?', payCash: 'Espèces', payCard: 'Carte', extrasWhat: 'De quoi avez-vous besoin ?', extrasPh: 'Autre chose ? (facultatif)',
    extra_water: 'Eau', extra_napkins: 'Serviettes', extra_cutlery: 'Couverts', extra_ice: 'Glaçons', extra_plates: 'Assiettes', extra_clean: 'Nettoyer la table',
    contactTab: 'Contact', contactSub: 'Demandez ce qu’il vous faut depuis votre table, un serveur arrive', youAreAt: 'Vous êtes à la', backToCart: 'Continuer la commande', askStaff: 'Demander au serveur',
    askStaffInPerson: 'Demandez à un serveur pour tout besoin',
    yourBill: 'Votre addition', yourBillSub: 'Ce que votre table doit pour l’instant', seeBill: 'Voir l’addition', billEmpty: 'Rien sur l’addition pour le moment',
    billEmptySub: 'Les commandes apparaissent ici une fois confirmées', discount: 'Remise', serviceCharge: 'Service', tax: 'TVA', paidAlready: 'Payé',
    amountDue: 'Reste à payer', refresh: 'Actualiser', askBillHow: 'Demander l’addition — comment payez-vous ?',
    needName: 'Indiquez votre nom', needPhone: 'Indiquez votre numéro', badPhone: 'Ce numéro n’est pas valide', needAddressOnly: 'Indiquez votre adresse',
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
  t.locale = { ar: 'ar-EG-u-nu-latn', en: 'en-GB', fr: 'fr-FR' }[lang]; // Latin digits (0-9), not Hindi
  t.currency = (c) => d.currency[c] || c;
  t.num = (n) => new Intl.NumberFormat(t.locale).format(n); // digits as in prices
  return t;
}
