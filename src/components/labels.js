export const CATEGORY_LABELS = {
  aces:          'Jedynki',
  twos:          'Dwójki',
  threes:        'Trójki',
  fours:         'Czwórki',
  fives:         'Piątki',
  sixes:         'Szóstki',
  threeOfAKind:  'Trójka',
  fourOfAKind:   'Kareta',
  fullHouse:     'Full',
  smallStraight: 'Mały strit',
  largeStraight: 'Duży strit',
  yahtzee:       'Generał',
  chance:        'Szansa',
};

export const UPPER = ['aces', 'twos', 'threes', 'fours', 'fives', 'sixes'];

export function pluralRzut(n) {
  if (n === 1) return 'RZUT';
  if (n >= 2 && n <= 4) return 'RZUTY';
  return 'RZUTÓW';
}
