// Garage and safehouse shop UI for SOLMAR: the pause screen's garage panel
// lists every rare car the player has stolen and parked (the collection),
// the upgrade shop with prices and levels, and the safehouse payoff. Buying
// goes through save.js so the ledger and the save file never disagree. The
// panel re-renders whenever the pause menu opens, so cash and levels are
// always read live from state — never cached.
import { formatCash } from './rng.js';
import { CAR_MODELS } from './state.js';
import { SHOP, buyUpgrade } from './save.js';

export class GaragePanel {
  constructor(state, bus, toastFn) {
    this.state = state; this.bus = bus; this.toast = toastFn;
    this.el = document.getElementById('garage-panel');
    if (!this.el) {
      // The pause screen carries the panel; create it if the markup lacks it.
      const pause = document.getElementById('pause-stats');
      if (pause) {
        this.el = document.createElement('div');
        this.el.id = 'garage-panel';
        pause.parentNode.insertBefore(this.el, pause.nextSibling);
      }
    }
  }
  render() {
    if (!this.el) return;
    const s = this.state.s;
    const rare = CAR_MODELS.filter(m => m.rare);
    const carsHtml = rare.map(m => {
      const owned = s.collectedCars.includes(m.id);
      return '<div class="garage-car' + (owned ? ' owned' : '') + '">' + (owned ? '● ' : '○ ') + m.name + (owned ? ' — PARKED' : ' — steal one to collect') + '</div>';
    }).join('');
    const shopHtml = SHOP.map(item => {
      let level = '', cost = item.cost, disabled = '';
      if (item.id === 'safehouse') {
        level = s.safehousePaidOff ? 'PAID OFF' : 'NOT OWNED';
        if (s.safehousePaidOff) disabled = ' disabled';
      } else {
        const lv = s.upgrades[item.id] || 0;
        level = 'LV ' + lv + '/' + item.max;
        cost = item.cost * (lv + 1);
        if (lv >= item.max) disabled = ' disabled';
      }
      return '<div class="shop-row"><span>' + item.name + ' <b>' + level + '</b></span>' +
        '<button class="btn-ghost shop-buy" data-id="' + item.id + '"' + disabled + '>' + formatCash(cost) + '</button></div>';
    }).join('');
    this.el.innerHTML = '<h4>SAFEHOUSE GARAGE</h4><div class="garage-cars">' + carsHtml + '</div>' +
      '<h4>UPGRADES — CASH ' + formatCash(s.cash) + '</h4>' + shopHtml;
    this.el.querySelectorAll('.shop-buy').forEach(btn => {
      btn.addEventListener('click', () => {
        const res = buyUpgrade(this.state, btn.dataset.id);
        this.toast(res.reason);
        this.render();
      });
    });
  }
  // Cash value of the collection, for the results screen flavour line.
  collectionValue() {
    const rare = CAR_MODELS.filter(m => m.rare && this.state.s.collectedCars.includes(m.id));
    return rare.length * 1200;
  }
  rareOwned() { return CAR_MODELS.filter(m => m.rare && this.state.s.collectedCars.includes(m.id)).length; }
  rareTotal() { return CAR_MODELS.filter(m => m.rare).length; }
}
