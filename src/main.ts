import Phaser from "phaser";
import "./styles.css";
import { GameScene } from "./game/GameScene";

const getElement = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element as T;
};

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  width: 960,
  height: 640,
  backgroundColor: "#07121a",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 960,
    height: 640
  },
  render: {
    antialias: true,
    pixelArt: false
  },
  scene: [
    new GameScene({
      hpBar: getElement("planet-hp-bar"),
      score: getElement("score-value"),
      wave: getElement("wave-value"),
      cooldown: getElement("cooldown-value"),
      overlay: getElement("overlay"),
      startButton: getElement("start-button")
    })
  ]
});
